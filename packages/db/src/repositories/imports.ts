import {
  applyAction,
  dedupeBatch,
  type ImportCounters,
  type ImportProvider,
  type ImportProviderName
} from "@lifegraph/imports";
import { and, desc, eq, inArray, sql as statement } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { auditLogs, imports } from "../schema";
import { createObjectRepository } from "./objects";

export class ImportNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

/** A run already exists for this provider, or the run is not in a state that allows the action. */
export class ImportStateError extends Error {
  readonly code = "IMPORT_STATE_CONFLICT";
}

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

const MAX_RECORDED_ERRORS = 20;

export function createImportRepository(client: DatabaseClient) {
  const objectsRepository = createObjectRepository(client);

  return {
    /** Reserves a run. A partial unique index makes a second live run per provider impossible. */
    async start(ownerId: string, provider: ImportProviderName, requestId?: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [active] = await transaction.select().from(imports)
          .where(and(eq(imports.userId, ownerId), eq(imports.provider, provider), inArray(imports.status, ["PENDING", "RUNNING"])))
          .limit(1);
        if (active) throw new ImportStateError("An import for this provider is already in progress");

        const [row] = await transaction.insert(imports).values({ userId: ownerId, provider, status: "PENDING" }).returning();
        if (!row) throw new Error("Import insert returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "IMPORT_STARTED",
          requestId,
          metadata: { importId: row.id, provider }
        });
        return row;
      });
    },

    async get(ownerId: string, importId: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(imports)
          .where(and(eq(imports.id, importId), eq(imports.userId, ownerId)))
          .limit(1);
        if (!row) throw new ImportNotFoundError();
        return row;
      });
    },

    async list(ownerId: string, limit = 20) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        return transaction.select().from(imports)
          .where(eq(imports.userId, ownerId))
          .orderBy(desc(imports.createdAt))
          .limit(Math.min(Math.max(limit, 1), 100));
      });
    },

    /**
     * Runs one batch and persists the cursor before returning, so a crashed or interrupted import
     * resumes from the last committed page instead of restarting or skipping records.
     *
     * Returns `done: true` when the provider reports no further cursor.
     */
    async runBatch(ownerId: string, importId: string, provider: ImportProvider, requestId?: string) {
      const run = await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [locked] = await transaction.select().from(imports)
          .where(and(eq(imports.id, importId), eq(imports.userId, ownerId)))
          .for("update")
          .limit(1);
        if (!locked) throw new ImportNotFoundError();
        if (locked.status !== "PENDING" && locked.status !== "RUNNING") throw new ImportStateError("This import has already finished");
        if (locked.provider !== provider.provider) throw new ImportStateError("The provider does not match this import");

        const [updated] = await transaction.update(imports)
          .set({ status: "RUNNING", startedAt: locked.startedAt ?? new Date(), updatedAt: new Date() })
          .where(eq(imports.id, importId))
          .returning();
        if (!updated) throw new Error("Import status update returned no row");
        return updated;
      });

      let counters: ImportCounters = { imported: run.importedCount, skipped: run.skippedCount, errors: run.errorCount };
      const errors: Array<{ sourceExternalId: string; message: string }> = run.errorSummary?.errors?.slice(0, MAX_RECORDED_ERRORS) ?? [];

      try {
        const batch = await provider.fetchBatch(run.cursorState?.cursor ?? null);
        const { unique, duplicates } = dedupeBatch(batch.items);
        for (let index = 0; index < duplicates; index += 1) counters = applyAction(counters, "SKIP");

        for (const item of unique) {
          try {
            const applied = await objectsRepository.applyImported(ownerId, {
              provider: provider.provider,
              sourceExternalId: item.sourceExternalId,
              contentHash: item.contentHash,
              sourceModifiedAt: item.sourceModifiedAt,
              snapshot: item.snapshot
            });
            counters = applyAction(counters, applied.action);
          } catch (error) {
            counters = applyAction(counters, "ERROR");
            // One bad record must not abort the run; it is recorded and the batch continues.
            if (errors.length < MAX_RECORDED_ERRORS) {
              errors.push({ sourceExternalId: item.sourceExternalId, message: error instanceof Error ? error.message : "Unknown import error" });
            }
          }
        }

        const done = !batch.nextCursor;
        return client.db.transaction(async (transaction) => {
          await setOwnerContext(transaction, ownerId);
          const completedAt = done ? new Date() : null;
          const [updated] = await transaction.update(imports).set({
            status: done ? "COMPLETED" : "RUNNING",
            importedCount: counters.imported,
            skippedCount: counters.skipped,
            errorCount: counters.errors,
            cursorState: { cursor: batch.nextCursor },
            errorSummary: errors.length ? { errors } : null,
            completedAt,
            updatedAt: new Date()
          }).where(eq(imports.id, importId)).returning();
          if (!updated) throw new Error("Import batch update returned no row");

          if (done) {
            await transaction.insert(auditLogs).values({
              actorUserId: ownerId,
              actorType: "USER",
              action: "IMPORT_COMPLETED",
              requestId,
              metadata: { importId, provider: provider.provider, imported: counters.imported, skipped: counters.skipped, errors: counters.errors }
            });
          }
          return { import: updated, done };
        });
      } catch (error) {
        // A provider-level failure fails the run but preserves the cursor, so it can be retried.
        const message = error instanceof Error ? error.message : "Unknown import error";
        await client.db.transaction(async (transaction) => {
          await setOwnerContext(transaction, ownerId);
          await transaction.update(imports).set({
            status: "FAILED",
            importedCount: counters.imported,
            skippedCount: counters.skipped,
            errorCount: counters.errors + 1,
            errorSummary: { errors: [...errors, { sourceExternalId: "", message }].slice(0, MAX_RECORDED_ERRORS) },
            completedAt: new Date(),
            updatedAt: new Date()
          }).where(eq(imports.id, importId));
          await transaction.insert(auditLogs).values({
            actorUserId: ownerId,
            actorType: "USER",
            action: "IMPORT_FAILED",
            requestId,
            metadata: { importId, provider: provider.provider }
          });
        });
        throw error;
      }
    },

    /** Re-opens a FAILED run at its stored cursor. Completed runs are never reused. */
    async resume(ownerId: string, importId: string, requestId?: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [locked] = await transaction.select().from(imports)
          .where(and(eq(imports.id, importId), eq(imports.userId, ownerId)))
          .for("update")
          .limit(1);
        if (!locked) throw new ImportNotFoundError();
        if (locked.status !== "FAILED") throw new ImportStateError("Only a failed import can be resumed");

        const [active] = await transaction.select().from(imports)
          .where(and(eq(imports.userId, ownerId), eq(imports.provider, locked.provider), inArray(imports.status, ["PENDING", "RUNNING"])))
          .limit(1);
        if (active) throw new ImportStateError("An import for this provider is already in progress");

        const [updated] = await transaction.update(imports)
          .set({ status: "RUNNING", completedAt: null, updatedAt: new Date() })
          .where(eq(imports.id, importId))
          .returning();
        if (!updated) throw new Error("Import resume returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "IMPORT_RESUMED",
          requestId,
          metadata: { importId, provider: locked.provider, cursor: locked.cursorState?.cursor ?? null }
        });
        return updated;
      });
    }
  };
}
