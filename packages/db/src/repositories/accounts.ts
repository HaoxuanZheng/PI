import { and, eq, inArray, isNull, sql as statement } from "drizzle-orm";
import { deletionGraceDays, purgeAfter } from "@lifegraph/privacy";
import type { StoragePort } from "@lifegraph/storage";
import type { DatabaseClient } from "../index";
import {
  analyticsEvents,
  auditLogs,
  embeddingChunks,
  imports,
  permissionGrants,
  publications,
  users
} from "../schema";
import { createFileRepository } from "./files";
import { ObjectNotFoundError, RevisionConflictError, createObjectRepository } from "./objects";

export class AccountNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export class AccountDeletionStateError extends Error {
  readonly code = "DELETION_STATE_CONFLICT";
}

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

export type DeletionStatus = {
  accountStatus: string;
  deletionRequestedAt: Date | null;
  deletionPurgeAfter: Date | null;
  deletionPurgedAt: Date | null;
  graceDays: number;
};

export type PurgeSummary = {
  objectsDeleted: number;
  publicationsUnpublished: number;
  grantsRevoked: number;
  importsFailed: number;
  embeddingsPurged: number;
  filesPurged: number;
  analyticsDeleted: number;
  purgedAt: string;
};

export function createAccountRepository(client: DatabaseClient, storage: StoragePort) {
  const objectsRepository = createObjectRepository(client);
  const filesRepository = createFileRepository(client, storage);

  async function readStatus(transaction: Transaction, ownerId: string): Promise<DeletionStatus> {
    const [row] = await transaction.select().from(users).where(eq(users.id, ownerId)).limit(1);
    if (!row) throw new AccountNotFoundError();
    return {
      accountStatus: row.accountStatus,
      deletionRequestedAt: row.deletionRequestedAt,
      deletionPurgeAfter: row.deletionPurgeAfter,
      deletionPurgedAt: row.deletionPurgedAt,
      graceDays: deletionGraceDays
    };
  }

  return {
    async status(ownerId: string): Promise<DeletionStatus> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        return readStatus(transaction, ownerId);
      });
    },

    /**
     * Requests deletion with a recovery window. The account is disabled
     * immediately (DELETION_PENDING fails provisionActor), while the purge
     * itself is not due until purgeAfter(requestedAt). Purge execution is
     * a future milestone; this slice only records the request honestly.
     */
    async requestDeletion(ownerId: string, requestId?: string): Promise<DeletionStatus> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(users).where(eq(users.id, ownerId)).for("update").limit(1);
        if (!row) throw new AccountNotFoundError();
        if (row.accountStatus === "DELETION_PENDING") throw new AccountDeletionStateError("Deletion is already pending");
        if (row.accountStatus !== "ACTIVE") throw new AccountDeletionStateError("Only active accounts may request deletion");

        const requestedAt = new Date();
        const purgeAt = purgeAfter(requestedAt);
        const [updated] = await transaction.update(users).set({
          accountStatus: "DELETION_PENDING",
          deletionRequestedAt: requestedAt,
          deletionPurgeAfter: purgeAt,
          deletionPurgedAt: null,
          updatedAt: requestedAt
        }).where(eq(users.id, ownerId)).returning();
        if (!updated) throw new AccountNotFoundError();

        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "ACCOUNT_DELETION_REQUESTED",
          resourceType: "ACCOUNT",
          resourceId: ownerId,
          requestId,
          metadata: { purgeAfter: purgeAt.toISOString() }
        });

        return readStatus(transaction, ownerId);
      });
    },

    async cancelDeletion(ownerId: string, requestId?: string): Promise<DeletionStatus> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(users).where(eq(users.id, ownerId)).for("update").limit(1);
        if (!row) throw new AccountNotFoundError();
        if (row.accountStatus !== "DELETION_PENDING") throw new AccountDeletionStateError("No pending deletion to cancel");
        if (row.deletionPurgedAt !== null) throw new AccountDeletionStateError("Account purge already completed");

        const [updated] = await transaction.update(users).set({
          accountStatus: "ACTIVE",
          deletionRequestedAt: null,
          deletionPurgeAfter: null,
          deletionPurgedAt: null,
          updatedAt: new Date()
        }).where(eq(users.id, ownerId)).returning();
        if (!updated) throw new AccountNotFoundError();

        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "ACCOUNT_DELETION_CANCELLED",
          resourceType: "ACCOUNT",
          resourceId: ownerId,
          requestId,
          metadata: {}
        });

        return readStatus(transaction, ownerId);
      });
    },

    /**
     * Executes a deletion request after its recovery window has elapsed.
     *
     * Each step is independently idempotent so a failed purge can be retried:
     * soft-deletes skip vanished objects, bulk updates only touch live rows,
     * and the completion marker is written last. Canonical rows are never
     * hard-deleted (revisions and audit stay for accountability); derived and
     * identifying data (vectors, stored bytes, analytics events) is removed.
     * Provider tokens need no revocation: importers run on operator-supplied
     * environment tokens, never per-user stored credentials.
     */
    async purgeAccount(ownerId: string, requestId?: string): Promise<PurgeSummary> {
      const gate = await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(users).where(eq(users.id, ownerId)).limit(1);
        if (!row) throw new AccountNotFoundError();
        if (row.accountStatus !== "DELETION_PENDING") throw new AccountDeletionStateError("No pending deletion to purge");
        if (row.deletionPurgedAt !== null) throw new AccountDeletionStateError("Account purge already completed");
        if (!row.deletionPurgeAfter || row.deletionPurgeAfter.getTime() > Date.now()) {
          throw new AccountDeletionStateError("The recovery window has not elapsed");
        }
        return row;
      });
      void gate;

      // Soft-delete every live object through the standard path, so each one
      // gains a DELETE revision, tombstones its edges, and triggers embedding,
      // file, and publication invalidation. Paged because list() caps at 100.
      let objectsDeleted = 0;
      for (;;) {
        const page = await objectsRepository.list(ownerId, 100);
        if (!page.length) break;
        for (const entry of page) {
          try {
            await objectsRepository.softDelete(ownerId, entry.object.id, entry.currentRevision.id, requestId);
            objectsDeleted++;
          } catch (error) {
            if (error instanceof ObjectNotFoundError) continue;
            if (error instanceof RevisionConflictError) {
              try {
                const current = await objectsRepository.get(ownerId, entry.object.id);
                await objectsRepository.softDelete(ownerId, entry.object.id, current.currentRevision.id, requestId);
                objectsDeleted++;
              } catch (retryError) {
                if (retryError instanceof ObjectNotFoundError) continue;
                throw retryError;
              }
              continue;
            }
            throw error;
          }
        }
      }

      const bulk = await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);

        const unpublished = await transaction.update(publications).set({
          status: "UNPUBLISHED",
          publishedAt: null,
          unpublishedAt: new Date(),
          updatedAt: new Date()
        }).where(and(
          eq(publications.ownerId, ownerId),
          eq(publications.status, "PUBLISHED")
        )).returning({ id: publications.id });

        const revoked = await transaction.update(permissionGrants).set({ revokedAt: new Date() }).where(and(
          eq(permissionGrants.ownerId, ownerId),
          isNull(permissionGrants.revokedAt)
        )).returning({ id: permissionGrants.id });

        const failed = await transaction.update(imports).set({ status: "FAILED", updatedAt: new Date() }).where(and(
          eq(imports.userId, ownerId),
          inArray(imports.status, ["PENDING", "RUNNING"])
        )).returning({ id: imports.id });

        const vectors = await transaction.select({ id: embeddingChunks.id }).from(embeddingChunks)
          .where(eq(embeddingChunks.ownerId, ownerId));
        if (vectors.length) {
          await transaction.delete(embeddingChunks).where(eq(embeddingChunks.ownerId, ownerId));
        }

        const events = await transaction.select({ id: analyticsEvents.id }).from(analyticsEvents)
          .where(eq(analyticsEvents.userId, ownerId));
        if (events.length) {
          await transaction.delete(analyticsEvents).where(eq(analyticsEvents.userId, ownerId));
        }

        const purgedAt = new Date();
        await transaction.update(users).set({ deletionPurgedAt: purgedAt, updatedAt: purgedAt })
          .where(eq(users.id, ownerId));

        return {
          publicationsUnpublished: unpublished.length,
          grantsRevoked: revoked.length,
          importsFailed: failed.length,
          embeddingsPurged: vectors.length,
          analyticsDeleted: events.length,
          purgedAt
        };
      });

      // Remove stored bytes for every file the cascade gave up on. Bounded
      // batches until none remain, mirroring the deletion-propagation job.
      let filesPurged = 0;
      for (;;) {
        const { purged } = await filesRepository.purgeDeleted(ownerId, 500);
        filesPurged += purged;
        if (!purged) break;
      }

      await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "ACCOUNT_PURGED",
          resourceType: "ACCOUNT",
          resourceId: ownerId,
          requestId,
          metadata: {
            objectCount: objectsDeleted,
            publicationCount: bulk.publicationsUnpublished,
            grantCount: bulk.grantsRevoked,
            importCount: bulk.importsFailed,
            embeddingCount: bulk.embeddingsPurged,
            fileCount: filesPurged,
            analyticsCount: bulk.analyticsDeleted
          }
        });
      });

      return {
        objectsDeleted,
        publicationsUnpublished: bulk.publicationsUnpublished,
        grantsRevoked: bulk.grantsRevoked,
        importsFailed: bulk.importsFailed,
        embeddingsPurged: bulk.embeddingsPurged,
        filesPurged,
        analyticsDeleted: bulk.analyticsDeleted,
        purgedAt: bulk.purgedAt.toISOString()
      };
    }
  };
}
