import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/index";
import {
  IdempotencyInFlightError,
  IdempotencyKeyError,
  createIdempotencyRepository,
  parseIdempotencyKey
} from "../src/repositories/idempotency";
import { createObjectRepository } from "../src/repositories/objects";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

const username = (id: string) => `u${id.replaceAll("-", "").slice(0, 12)}`;

integration("idempotency repository", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
  }, 30_000);

  afterAll(async () => client?.close());

  it("replays stored responses, rejects live duplicates and bad keys", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const idempotency = createIdempotencyRepository(client);
    const owner = randomUUID();
    await createObjectRepository(client).provisionUser({ id: owner, username: username(owner), email: null });

    expect(parseIdempotencyKey(null)).toBeNull();
    expect(parseIdempotencyKey("order-1")).toBe("order-1");
    expect(() => parseIdempotencyKey("")).toThrow(IdempotencyKeyError);
    expect(() => parseIdempotencyKey("has space")).toThrow(IdempotencyKeyError);
    expect(() => parseIdempotencyKey("x".repeat(65))).toThrow(IdempotencyKeyError);

    // Fresh keys miss.
    expect(await idempotency.find(owner, "order-1")).toBeNull();

    // Reserve + complete replays the exact response.
    await idempotency.reserve(owner, "order-1", "POST", "/api/v1/objects");
    await expect(idempotency.find(owner, "order-1")).rejects.toBeInstanceOf(IdempotencyInFlightError);
    await expect(idempotency.reserve(owner, "order-1", "POST", "/api/v1/objects"))
      .rejects.toBeInstanceOf(IdempotencyInFlightError);
    await idempotency.complete(owner, "order-1", 201, { data: { id: "abc" } });
    expect(await idempotency.find(owner, "order-1")).toEqual({ statusCode: 201, body: { data: { id: "abc" } } });

    // Keys are per-user: the same key works for someone else.
    const other = randomUUID();
    await createObjectRepository(client).provisionUser({ id: other, username: username(other), email: null });
    expect(await idempotency.find(other, "order-1")).toBeNull();

    // Handler errors must drop the reservation so a retry proceeds.
    await idempotency.reserve(owner, "order-2", "POST", "/api/v1/objects");
    await idempotency.discard(owner, "order-2");
    expect(await idempotency.find(owner, "order-2")).toBeNull();
    await idempotency.reserve(owner, "order-2", "POST", "/api/v1/objects");
    await idempotency.complete(owner, "order-2", 201, { data: { id: "def" } });
    expect(await idempotency.find(owner, "order-2")).toEqual({ statusCode: 201, body: { data: { id: "def" } } });

    // Expired rows read as absent so the key is reusable.
    await client.sql.begin(async (sql) => {
      await sql`select set_config('app.current_user_id', ${owner}, true)`;
      await sql`update idempotency_keys set expires_at = now() - interval '1 hour' where user_id = ${owner} and idempotency_key = 'order-2'`;
    });
    expect(await idempotency.find(owner, "order-2")).toBeNull();
    await idempotency.reserve(owner, "order-2", "POST", "/api/v1/objects");
    await idempotency.complete(owner, "order-2", 201, { data: { id: "ghi" } });
    expect(await idempotency.find(owner, "order-2")).toEqual({ statusCode: 201, body: { data: { id: "ghi" } } });
  }, 60_000);
});
