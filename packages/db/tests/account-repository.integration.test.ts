import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createInMemoryStorage } from "@lifegraph/storage";
import type { AIProvider } from "@lifegraph/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/index";
import { AccountDeletionStateError, createAccountRepository } from "../src/repositories/accounts";
import { createObjectRepository } from "../src/repositories/objects";
import { createPermissionRepository } from "../src/repositories/permissions";
import { createRelationshipRepository } from "../src/repositories/relationships";
import { createRetrievalRepository } from "../src/repositories/retrieval";
import { createFileRepository } from "../src/repositories/files";
import { createImportRepository } from "../src/repositories/imports";
import { createOnboardingRepository } from "../src/repositories/onboarding";
import { createPublicationRepository } from "../src/repositories/publications";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

const username = (id: string) => `u${id.replaceAll("-", "").slice(0, 12)}`;
const noteSnapshot = (title: string, content: string) => ({
  schemaVersion: 1 as const,
  type: "NOTE" as const,
  title,
  body: { format: "plain_text" as const, content },
  tags: [],
  customFields: {}
});
const embeddingProvider: AIProvider = {
  name: "test",
  model: "fixed-1536",
  generateStructured: async () => { throw new Error("unused"); },
  generateText: async () => { throw new Error("unused"); },
  embed: async (inputs) => inputs.map(() => Array.from({ length: 1536 }, () => 0.01))
};

async function count(ownerId: string, table: string, extra = "") {
  if (!client) throw new Error("TEST_DATABASE_URL is required");
  const rows = await client.sql.begin(async (sql) => {
    await sql`select set_config('app.current_user_id', ${ownerId}, true)`;
    return sql.unsafe(`select count(*)::int as n from ${table} where ${extra || "true"}`);
  });
  return Number(rows[0]?.n ?? 0);
}

integration("account purge", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
  }, 30_000);

  afterAll(async () => client?.close());

  it("refuses early purge and executes a full purge after the window", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const storage = createInMemoryStorage();
    const accounts = createAccountRepository(client, storage);
    const objects = createObjectRepository(client);
    const permissions = createPermissionRepository(client);
    const relationships = createRelationshipRepository(client);
    const retrieval = createRetrievalRepository(client);
    const files = createFileRepository(client, storage);
    const imports = createImportRepository(client);
    const onboarding = createOnboardingRepository(client);
    const publications = createPublicationRepository(client);

    const ownerA = randomUUID();
    const ownerB = randomUUID();
    await objects.provisionUser({ id: ownerA, username: username(ownerA), email: null });
    await objects.provisionUser({ id: ownerB, username: username(ownerB), email: null });

    const first = await objects.create(ownerA, { snapshot: noteSnapshot("First", "alpha content"), visibility: "PRIVATE" });
    const second = await objects.create(ownerA, { snapshot: noteSnapshot("Second", "beta content"), visibility: "PRIVATE" });
    await relationships.create(ownerA, first.object.id, { targetObjectId: second.object.id, relationshipType: "MENTIONS" }, "test-edge");
    await permissions.grant(ownerA, first.object.id, { principalType: "USER", principalId: ownerB, capability: "READ" }, "test-grant");
    await imports.start(ownerA, "GOOGLE_DRIVE");
    await onboarding.update(ownerA, { action: "start" });
    await retrieval.indexObject(ownerA, first.object.id, embeddingProvider);
    const intent = await files.createIntent(ownerA, { objectId: first.object.id, filename: "note.pdf", mimeType: "application/pdf", byteSize: 1024 });
    await files.complete(ownerA, intent.file.id, { checksum: "c".repeat(64), byteSize: 1024 });
    const published = await publications.publishObject(ownerA, {
      sourceObjectId: second.object.id,
      slug: "second-note",
      fields: ["title"],
      expectedRevisionId: second.currentRevision.id,
      confirm: true
    });
    expect(published.status).toBe("PUBLISHED");
    expect(storage.objects.size).toBeGreaterThan(0);

    await accounts.requestDeletion(ownerA);
    await expect(accounts.purgeAccount(ownerA)).rejects.toBeInstanceOf(AccountDeletionStateError);

    // Move the request window into the past: requested 8 days ago, due yesterday.
    await client.sql.begin(async (sql) => {
      await sql`select set_config('app.current_user_id', ${ownerA}, true)`;
      await sql`update users set deletion_requested_at = now() - interval '8 days', deletion_purge_after = now() - interval '1 day' where id = ${ownerA}`;
    });

    const summary = await accounts.purgeAccount(ownerA);
    expect(summary.objectsDeleted).toBe(2);
    expect(summary.publicationsUnpublished).toBe(1);
    expect(summary.grantsRevoked).toBe(1);
    expect(summary.importsFailed).toBe(1);
    expect(summary.embeddingsPurged).toBeGreaterThanOrEqual(1);
    expect(summary.filesPurged).toBe(1);
    expect(summary.analyticsDeleted).toBeGreaterThanOrEqual(1);

    // Live reads are empty but history survives for the owner.
    expect(await objects.list(ownerA, 100)).toHaveLength(0);
    expect((await objects.revisions(ownerA, first.object.id)).length).toBeGreaterThanOrEqual(2);
    expect(await relationships.related(ownerA, first.object.id)).toHaveLength(0);
    expect(await count(ownerA, "publications", "status = 'PUBLISHED'")).toBe(0);
    expect(await count(ownerA, "embedding_chunks", "")).toBe(0);
    expect(await count(ownerA, "analytics_events", "")).toBe(0);
    expect(await count(ownerA, "permissions", "revoked_at IS NULL")).toBe(0);
    expect(storage.objects.size).toBe(0);

    const audits = await client.sql.begin(async (sql) => {
      await sql`select set_config('app.current_user_id', ${ownerA}, true)`;
      return sql`select action from audit_logs where actor_user_id = ${ownerA} and resource_type = 'ACCOUNT' and action = 'ACCOUNT_PURGED'`;
    });
    expect(audits).toHaveLength(1);

    const status = await accounts.status(ownerA);
    expect(status.accountStatus).toBe("DELETION_PENDING");
    expect(status.deletionPurgedAt).not.toBeNull();

    // Purge is not repeatable and cancellation is closed after execution.
    await expect(accounts.purgeAccount(ownerA)).rejects.toBeInstanceOf(AccountDeletionStateError);
    await expect(accounts.cancelDeletion(ownerA)).rejects.toBeInstanceOf(AccountDeletionStateError);
  }, 60_000);
});
