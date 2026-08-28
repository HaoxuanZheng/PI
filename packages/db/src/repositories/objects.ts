import type { CreateObjectInput, ObjectSnapshot, RestoreRevisionInput, UpdateObjectInput } from "@lifegraph/domain";
import { and, desc, eq, isNull, sql as statement } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { auditLogs, objectRevisions, objects, users } from "../schema";
import { createPermissionRepository } from "./permissions";

export class ObjectNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export class RevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";
}

export class ObjectTypeConflictError extends Error {
  readonly code = "VALIDATION_FAILED";
}

export type ObjectWithCurrentRevision = {
  object: typeof objects.$inferSelect;
  currentRevision: typeof objectRevisions.$inferSelect;
};

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

function toDate(value: string | null | undefined, current: Date | null = null) {
  return value === undefined ? current : value === null ? null : new Date(value);
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

async function readCurrent(transaction: Transaction, objectId: string, includeDeleted = false) {
  const rows = await transaction
    .select({ object: objects, currentRevision: objectRevisions })
    .from(objects)
    .innerJoin(objectRevisions, eq(objects.currentRevisionId, objectRevisions.id))
    .where(and(
      eq(objects.id, objectId),
      includeDeleted ? undefined : isNull(objects.deletedAt)
    ))
    .limit(1);
  return rows[0] ?? null;
}

export function createObjectRepository(client: DatabaseClient) {
  const authorization = createPermissionRepository(client);
  return {
    async provisionUser(input: { id: string; username: string; email: string | null; displayName?: string | null }) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, input.id);
        const rows = await transaction.insert(users).values({
          id: input.id,
          username: input.username,
          email: input.email,
          displayName: input.displayName ?? null
        }).onConflictDoUpdate({
          target: users.id,
          set: { email: input.email, updatedAt: new Date() }
        }).returning();
        return rows[0];
      });
    },

    async getUser(ownerId: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const rows = await transaction.select().from(users).where(eq(users.id, ownerId)).limit(1);
        return rows[0] ?? null;
      });
    },

    async create(ownerId: string, input: CreateObjectInput): Promise<ObjectWithCurrentRevision> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [object] = await transaction.insert(objects).values({
          ownerId,
          type: input.snapshot.type,
          title: input.snapshot.title ?? null,
          summary: input.snapshot.summary ?? null,
          visibility: input.visibility,
          observedAt: toDate(input.observedAt),
          effectiveFrom: toDate(input.effectiveFrom),
          effectiveTo: toDate(input.effectiveTo)
        }).returning();
        if (!object) throw new Error("Object insert returned no row");

        const [revision] = await transaction.insert(objectRevisions).values({
          objectId: object.id,
          snapshot: input.snapshot,
          changeType: "CREATE",
          createdByType: "USER",
          createdByUserId: ownerId
        }).returning();
        if (!revision) throw new Error("Revision insert returned no row");

        const [updated] = await transaction.update(objects)
          .set({ currentRevisionId: revision.id, updatedAt: revision.createdAt })
          .where(and(eq(objects.id, object.id), eq(objects.ownerId, ownerId)))
          .returning();
        if (!updated) throw new Error("Object current revision update returned no row");
        return { object: updated, currentRevision: revision };
      });
    },

    async list(actorUserId: string, limit = 50): Promise<ObjectWithCurrentRevision[]> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        return transaction.select({ object: objects, currentRevision: objectRevisions })
          .from(objects)
          .innerJoin(objectRevisions, eq(objects.currentRevisionId, objectRevisions.id))
          .where(isNull(objects.deletedAt))
          .orderBy(desc(objects.updatedAt))
          .limit(Math.min(Math.max(limit, 1), 100));
      });
    },

    async get(actorUserId: string, objectId: string): Promise<ObjectWithCurrentRevision> {
      await authorization.assert({ actorUserId, action: "READ", resourceType: "OBJECT", resourceId: objectId });
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const result = await readCurrent(transaction, objectId);
        if (!result) throw new ObjectNotFoundError();
        return result;
      });
    },

    async update(actorUserId: string, objectId: string, input: UpdateObjectInput, requestId?: string): Promise<ObjectWithCurrentRevision> {
      await authorization.assert({ actorUserId, action: "EDIT", resourceType: "OBJECT", resourceId: objectId });
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const [current] = await transaction.select().from(objects)
          .where(and(eq(objects.id, objectId), isNull(objects.deletedAt)))
          .for("update")
          .limit(1);
        if (!current || !current.currentRevisionId) throw new ObjectNotFoundError();
        if (current.currentRevisionId !== input.expectedRevisionId) throw new RevisionConflictError();
        if (current.type !== input.snapshot.type) throw new ObjectTypeConflictError("An object's type cannot change between revisions");

        const currentState = await readCurrent(transaction, objectId);
        if (!currentState) throw new ObjectNotFoundError();
        const metadataUnchanged =
          (input.visibility === undefined || input.visibility === current.visibility) &&
          (input.observedAt === undefined || toDate(input.observedAt)?.getTime() === current.observedAt?.getTime()) &&
          (input.effectiveFrom === undefined || toDate(input.effectiveFrom)?.getTime() === current.effectiveFrom?.getTime()) &&
          (input.effectiveTo === undefined || toDate(input.effectiveTo)?.getTime() === current.effectiveTo?.getTime());
        if (sameValue(input.snapshot, currentState.currentRevision.snapshot) && metadataUnchanged) return currentState;

        const [revision] = await transaction.insert(objectRevisions).values({
          objectId,
          previousRevisionId: current.currentRevisionId,
          snapshot: input.snapshot,
          changeType: "UPDATE",
          createdByType: "USER",
          createdByUserId: actorUserId
        }).returning();
        if (!revision) throw new Error("Revision insert returned no row");

        await transaction.update(objects).set({
          title: input.snapshot.title ?? null,
          summary: input.snapshot.summary ?? null,
          visibility: input.visibility ?? current.visibility,
          observedAt: toDate(input.observedAt, current.observedAt),
          effectiveFrom: toDate(input.effectiveFrom, current.effectiveFrom),
          effectiveTo: toDate(input.effectiveTo, current.effectiveTo),
          currentRevisionId: revision.id,
          updatedAt: revision.createdAt
        }).where(eq(objects.id, objectId));

        if (input.visibility !== undefined && input.visibility !== current.visibility) {
          await transaction.insert(auditLogs).values({
            actorUserId,
            actorType: "USER",
            action: "OBJECT_VISIBILITY_CHANGED",
            resourceType: "OBJECT",
            resourceId: objectId,
            requestId,
            metadata: { from: current.visibility, to: input.visibility }
          });
        }

        const result = await readCurrent(transaction, objectId);
        if (!result) throw new ObjectNotFoundError();
        return result;
      });
    },

    async revisions(actorUserId: string, objectId: string) {
      await authorization.assert({ actorUserId, action: "READ", resourceType: "OBJECT", resourceId: objectId });
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const current = await readCurrent(transaction, objectId, true);
        if (!current) throw new ObjectNotFoundError();
        return transaction.select().from(objectRevisions)
          .where(eq(objectRevisions.objectId, objectId))
          .orderBy(desc(objectRevisions.createdAt));
      });
    },

    async restore(actorUserId: string, objectId: string, input: RestoreRevisionInput, requestId?: string): Promise<ObjectWithCurrentRevision> {
      await authorization.assert({ actorUserId, action: "EDIT", resourceType: "OBJECT", resourceId: objectId });
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const [current] = await transaction.select().from(objects)
          .where(and(eq(objects.id, objectId), isNull(objects.deletedAt)))
          .for("update")
          .limit(1);
        if (!current || !current.currentRevisionId) throw new ObjectNotFoundError();
        if (current.currentRevisionId !== input.expectedRevisionId) throw new RevisionConflictError();

        const [target] = await transaction.select().from(objectRevisions)
          .where(and(eq(objectRevisions.id, input.revisionId), eq(objectRevisions.objectId, objectId)))
          .limit(1);
        if (!target) throw new ObjectNotFoundError();

        const [revision] = await transaction.insert(objectRevisions).values({
          objectId,
          previousRevisionId: current.currentRevisionId,
          snapshot: target.snapshot as ObjectSnapshot,
          changeType: "RESTORE",
          createdByType: "RESTORE",
          createdByUserId: actorUserId
        }).returning();
        if (!revision) throw new Error("Revision insert returned no row");

        await transaction.update(objects).set({
          type: target.snapshot.type,
          title: target.snapshot.title ?? null,
          summary: target.snapshot.summary ?? null,
          currentRevisionId: revision.id,
          updatedAt: revision.createdAt
        }).where(eq(objects.id, objectId));

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "OBJECT_REVISION_RESTORED",
          resourceType: "OBJECT",
          resourceId: objectId,
          requestId,
          metadata: { restoredRevisionId: target.id, createdRevisionId: revision.id }
        });

        const result = await readCurrent(transaction, objectId);
        if (!result) throw new ObjectNotFoundError();
        return result;
      });
    },

    async softDelete(actorUserId: string, objectId: string, expectedRevisionId: string, requestId?: string) {
      await authorization.assert({ actorUserId, action: "ADMIN", resourceType: "OBJECT", resourceId: objectId });
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const [object] = await transaction.select().from(objects)
          .where(and(eq(objects.id, objectId), isNull(objects.deletedAt)))
          .for("update")
          .limit(1);
        if (!object || !object.currentRevisionId) throw new ObjectNotFoundError();
        if (object.currentRevisionId !== expectedRevisionId) throw new RevisionConflictError();
        const [currentRevision] = await transaction.select().from(objectRevisions)
          .where(and(eq(objectRevisions.objectId, objectId), eq(objectRevisions.id, object.currentRevisionId)))
          .limit(1);
        if (!currentRevision) throw new ObjectNotFoundError();

        const [revision] = await transaction.insert(objectRevisions).values({
          objectId,
          previousRevisionId: object.currentRevisionId,
          snapshot: currentRevision.snapshot,
          changeType: "DELETE",
          createdByType: "USER",
          createdByUserId: actorUserId
        }).returning();
        if (!revision) throw new Error("Revision insert returned no row");

        await transaction.update(objects).set({
          currentRevisionId: revision.id,
          deletedAt: new Date(),
          updatedAt: revision.createdAt
        }).where(eq(objects.id, objectId));

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "OBJECT_SOFT_DELETED",
          resourceType: "OBJECT",
          resourceId: objectId,
          requestId,
          metadata: { deletedRevisionId: revision.id }
        });
      });
    }
  };
}
