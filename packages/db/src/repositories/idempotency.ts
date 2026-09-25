import { eq, sql as statement } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { idempotencyKeys, users } from "../schema";

export class IdempotencyKeyError extends Error {
  readonly code = "VALIDATION_FAILED";
}

export class IdempotencyInFlightError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
}

/** Client keys are opaque but bounded: 1-64 URL-safe characters. */
export const idempotencyKeyPattern = /^[A-Za-z0-9_-]{1,64}$/;

/** Stored responses live 24 hours; a retry after that re-executes honestly. */
export const idempotencyTtlHours = 24;

export function parseIdempotencyKey(raw: string | null): string | null {
  if (raw === null) return null;
  const key = raw.trim();
  if (!idempotencyKeyPattern.test(key)) throw new IdempotencyKeyError("Idempotency-Key must be 1-64 URL-safe characters");
  return key;
}

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

export type StoredResponse = { statusCode: number; body: unknown } | null;

export function createIdempotencyRepository(client: DatabaseClient) {
  return {
    /**
     * Returns a completed response for replay, null when the key is fresh.
     * Expired rows are treated as absent and removed so the key is reusable.
     * A live reservation (no status yet) means a duplicate is in flight.
     */
    async find(ownerId: string, key: string): Promise<StoredResponse> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        return findByKey(transaction, ownerId, key);
      });
    },

    /**
     * Reserves a key before executing. A concurrent duplicate hits the unique
     * index and becomes an in-flight conflict instead of a second execution.
     */
    async reserve(ownerId: string, key: string, method: string, path: string): Promise<void> {
      try {
        await client.db.transaction(async (transaction) => {
          await setOwnerContext(transaction, ownerId);
          const [user] = await transaction.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
          if (!user) throw new IdempotencyKeyError("Unknown account for idempotency key");
          await transaction.insert(idempotencyKeys).values({
            userId: ownerId,
            idempotencyKey: key,
            method,
            path,
            expiresAt: new Date(Date.now() + idempotencyTtlHours * 3_600_000)
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new IdempotencyInFlightError("The same operation is already in flight");
        throw error;
      }
    },

    async complete(ownerId: string, key: string, statusCode: number, body: unknown): Promise<void> {
      await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        await transaction.update(idempotencyKeys).set({ statusCode, responseBody: body })
          .where(eq(idempotencyKeys.idempotencyKey, key));
      });
    },

    /** Drops a reservation after a handler error so a retry proceeds. */
    async discard(ownerId: string, key: string): Promise<void> {
      await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        await transaction.delete(idempotencyKeys).where(eq(idempotencyKeys.idempotencyKey, key));
      });
    }
  };
}

async function findByKey(
  transaction: Transaction,
  ownerId: string,
  key: string
): Promise<StoredResponse> {
  const rows = await transaction.execute(
    statement`select status_code as "statusCode", response_body as "body", expires_at as "expiresAt" from idempotency_keys where user_id = ${ownerId}::uuid and idempotency_key = ${key} limit 1`
  );
  const row = Array.from(rows)[0] as { statusCode: number | null; body: unknown; expiresAt: Date | string } | undefined;
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await transaction.execute(
      statement`delete from idempotency_keys where user_id = ${ownerId}::uuid and idempotency_key = ${key}`
    );
    return null;
  }
  if (row.statusCode === null) throw new IdempotencyInFlightError("The same operation is already in flight");
  return { statusCode: row.statusCode, body: row.body };
}

function isUniqueViolation(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}
