import {
  StorageValidationError,
  completeUploadInputSchema,
  deriveStorageKey,
  uploadIntentInputSchema,
  validateUpload,
  type CompleteUploadInput,
  type StoragePort,
  type UploadIntentInput
} from "@lifegraph/storage";
import { and, desc, eq, isNull, sql as statement } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { auditLogs, files, objects } from "../schema";
import { createPermissionRepository } from "./permissions";

export class FileNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

/** The file exists but its lifecycle state forbids the requested action. */
export class FileStateError extends Error {
  readonly code = "FILE_STATE_CONFLICT";
}

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

/**
 * Files inherit the authorization of the object they belong to: there is no separate file grant.
 * Every method therefore resolves the owning object first and asks the permission engine about it.
 */
export function createFileRepository(
  client: DatabaseClient,
  storage: StoragePort,
  options: { requireCleanScan?: boolean } = {}
) {
  const authorization = createPermissionRepository(client);
  // Secure by default: a file is only downloadable once a scanner has cleared it.
  const requireCleanScan = options.requireCleanScan ?? true;

  async function readFile(transaction: Transaction, fileId: string) {
    const rows = await transaction.select().from(files)
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Resolves a file's owning object without trusting the caller, then authorizes against it. */
  async function authorizeFile(actorUserId: string, fileId: string, action: "READ" | "EDIT" | "ADMIN") {
    const row = await client.db.transaction(async (transaction) => {
      await setOwnerContext(transaction, actorUserId);
      return readFile(transaction, fileId);
    });
    if (!row) throw new FileNotFoundError();
    await authorization.assert({ actorUserId, action, resourceType: "OBJECT", resourceId: row.objectId });
    return row;
  }

  return {
    async createIntent(actorUserId: string, input: UploadIntentInput, requestId?: string) {
      const parsed = uploadIntentInputSchema.parse(input);
      // Attaching bytes to an object is an edit of that object.
      await authorization.assert({ actorUserId, action: "EDIT", resourceType: "OBJECT", resourceId: parsed.objectId });
      const upload = validateUpload(parsed);
      const fileId = crypto.randomUUID();
      const storageKey = deriveStorageKey({ ownerId: actorUserId, fileId, filename: upload.filename });

      const row = await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const [object] = await transaction.select({ id: objects.id, ownerId: objects.ownerId }).from(objects)
          .where(and(eq(objects.id, parsed.objectId), isNull(objects.deletedAt)))
          .limit(1);
        if (!object) throw new FileNotFoundError();
        // Uploads land in the uploader's own storage prefix, so the object must be theirs.
        if (object.ownerId !== actorUserId) throw new StorageValidationError("Files can only be attached to your own objects");

        const [inserted] = await transaction.insert(files).values({
          id: fileId,
          ownerId: actorUserId,
          objectId: parsed.objectId,
          storageKey,
          originalFilename: upload.filename,
          mimeType: upload.mimeType,
          category: upload.category,
          byteSize: upload.byteSize
        }).returning();
        if (!inserted) throw new Error("File insert returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "FILE_UPLOAD_INTENT_CREATED",
          resourceType: "OBJECT",
          resourceId: parsed.objectId,
          requestId,
          // Metadata stays structural: never the filename, which can itself be private.
          metadata: { fileId, mimeType: upload.mimeType, category: upload.category, byteSize: upload.byteSize }
        });
        return inserted;
      });

      const ticket = await storage.createUploadUrl({ key: storageKey, mimeType: upload.mimeType });
      return { file: row, upload: ticket };
    },

    /** Confirms the bytes actually landed. Only the recorded size and a SHA-256 digest are accepted. */
    async complete(actorUserId: string, fileId: string, input: CompleteUploadInput, requestId?: string) {
      const parsed = completeUploadInputSchema.parse(input);
      const existing = await authorizeFile(actorUserId, fileId, "EDIT");
      if (existing.uploadStatus !== "PENDING") throw new FileStateError("This upload was already completed");

      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const [locked] = await transaction.select().from(files)
          .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
          .for("update")
          .limit(1);
        if (!locked) throw new FileNotFoundError();
        if (locked.uploadStatus !== "PENDING") throw new FileStateError("This upload was already completed");
        if (locked.byteSize !== parsed.byteSize) throw new FileStateError("The uploaded size does not match the reserved size");

        const completedAt = new Date();
        const [updated] = await transaction.update(files).set({
          uploadStatus: "STORED",
          checksum: parsed.checksum,
          completedAt
        }).where(eq(files.id, fileId)).returning();
        if (!updated) throw new Error("File completion returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "FILE_UPLOAD_COMPLETED",
          resourceType: "OBJECT",
          resourceId: locked.objectId,
          requestId,
          metadata: { fileId, byteSize: parsed.byteSize, checksum: parsed.checksum }
        });
        return updated;
      });
    },

    async get(actorUserId: string, fileId: string) {
      return authorizeFile(actorUserId, fileId, "READ");
    },

    async listForObject(actorUserId: string, objectId: string) {
      await authorization.assert({ actorUserId, action: "READ", resourceType: "OBJECT", resourceId: objectId });
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        return transaction.select().from(files)
          .where(and(eq(files.objectId, objectId), isNull(files.deletedAt)))
          .orderBy(desc(files.createdAt));
      });
    },

    /** Issues a short-lived signed read URL. Unscanned or unstored bytes are never served. */
    async createDownloadUrl(actorUserId: string, fileId: string) {
      const row = await authorizeFile(actorUserId, fileId, "READ");
      if (row.uploadStatus !== "STORED") throw new FileStateError("This upload has not been completed");
      if (row.scanStatus === "INFECTED" || row.scanStatus === "FAILED") throw new FileStateError("This file did not pass a malware scan");
      if (requireCleanScan && row.scanStatus !== "CLEAN") throw new FileStateError("This file is awaiting a malware scan");
      const ticket = await storage.createDownloadUrl({ key: row.storageKey });
      return { file: row, download: ticket };
    },

    /** Worker-facing hook. A scanner records its verdict here; product code never sets CLEAN. */
    async recordScanResult(ownerId: string, fileId: string, scanStatus: "CLEAN" | "INFECTED" | "FAILED", requestId?: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [locked] = await transaction.select().from(files)
          .where(and(eq(files.id, fileId), eq(files.ownerId, ownerId), isNull(files.deletedAt)))
          .for("update")
          .limit(1);
        if (!locked) throw new FileNotFoundError();
        if (locked.uploadStatus !== "STORED") throw new FileStateError("Only stored files can be scanned");

        const [updated] = await transaction.update(files).set({ scanStatus }).where(eq(files.id, fileId)).returning();
        if (!updated) throw new Error("File scan update returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "SYSTEM",
          action: "FILE_SCAN_RECORDED",
          resourceType: "OBJECT",
          resourceId: locked.objectId,
          requestId,
          metadata: { fileId, scanStatus }
        });
        return updated;
      });
    },

    /** Soft-deletes the record, then removes the stored bytes so deletion propagates to storage. */
    async softDelete(actorUserId: string, fileId: string, requestId?: string) {
      const existing = await authorizeFile(actorUserId, fileId, "EDIT");

      const removed = await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const [locked] = await transaction.select().from(files)
          .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
          .for("update")
          .limit(1);
        if (!locked) throw new FileNotFoundError();

        await transaction.update(files).set({ deletedAt: new Date() }).where(eq(files.id, fileId));
        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "FILE_SOFT_DELETED",
          resourceType: "OBJECT",
          resourceId: existing.objectId,
          requestId,
          metadata: { fileId }
        });
        return locked;
      });

      await storage.remove(removed.storageKey);
      return { fileId, objectId: removed.objectId };
    },

    /**
     * Removes stored bytes for files the database has already given up on: rows soft-deleted
     * directly, rows cascaded by the object deletion trigger, and rows still attached to a deleted
     * object. The last case matters because the trigger runs under row-level security, so an object
     * deleted by an ADMIN grantee cannot mark the owner's file rows. Intended for the
     * deletion-propagation job.
     */
    async purgeDeleted(ownerId: string, limit = 100) {
      const batch = Math.min(Math.max(limit, 1), 500);
      const rows = await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const result = await transaction.execute(statement`SELECT id, storage_key AS "storageKey" FROM files WHERE owner_id=${ownerId}::uuid AND (deleted_at IS NOT NULL OR EXISTS (SELECT 1 FROM objects o WHERE o.id=files.object_id AND o.deleted_at IS NOT NULL)) ORDER BY created_at ASC LIMIT ${batch}`);
        const pending = Array.from(result).map((row) => ({ id: String(row.id), storageKey: String(row.storageKey) }));
        // Mark before removing bytes, so a failed removal never leaves a readable row.
        if (pending.length) {
          await transaction.execute(statement`UPDATE files SET deleted_at=COALESCE(deleted_at, now()) WHERE owner_id=${ownerId}::uuid AND id = ANY(${pending.map((row) => row.id)}::uuid[])`);
        }
        return pending;
      });
      for (const row of rows) await storage.remove(row.storageKey);
      return { purged: rows.length };
    }
  };
}
