import { eq, sql as statement } from "drizzle-orm";
import { deletionGraceDays, purgeAfter } from "@lifegraph/privacy";
import type { DatabaseClient } from "../index";
import { auditLogs, users } from "../schema";

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
  graceDays: number;
};

export function createAccountRepository(client: DatabaseClient) {
  return {
    async status(ownerId: string): Promise<DeletionStatus> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(users).where(eq(users.id, ownerId)).limit(1);
        if (!row) throw new AccountNotFoundError();
        return {
          accountStatus: row.accountStatus,
          deletionRequestedAt: row.deletionRequestedAt,
          deletionPurgeAfter: row.deletionPurgeAfter,
          graceDays: deletionGraceDays
        };
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

        return {
          accountStatus: updated.accountStatus,
          deletionRequestedAt: updated.deletionRequestedAt,
          deletionPurgeAfter: updated.deletionPurgeAfter,
          graceDays: deletionGraceDays
        };
      });
    },

    async cancelDeletion(ownerId: string, requestId?: string): Promise<DeletionStatus> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(users).where(eq(users.id, ownerId)).for("update").limit(1);
        if (!row) throw new AccountNotFoundError();
        if (row.accountStatus !== "DELETION_PENDING") throw new AccountDeletionStateError("No pending deletion to cancel");

        const [updated] = await transaction.update(users).set({
          accountStatus: "ACTIVE",
          deletionRequestedAt: null,
          deletionPurgeAfter: null,
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

        return {
          accountStatus: updated.accountStatus,
          deletionRequestedAt: updated.deletionRequestedAt,
          deletionPurgeAfter: updated.deletionPurgeAfter,
          graceDays: deletionGraceDays
        };
      });
    }
  };
}
