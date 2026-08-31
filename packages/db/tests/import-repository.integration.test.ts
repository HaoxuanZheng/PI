import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { hashImportContent, type ImportBatch, type ImportProvider, type NormalizedImportItem } from "@lifegraph/imports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/index";
import { createObjectRepository } from "../src/repositories/objects";
import { createImportRepository, ImportNotFoundError, ImportStateError } from "../src/repositories/imports";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

const username = (id: string) => `u${id.replaceAll("-", "").slice(0, 12)}`;

function item(externalId: string, body: string): NormalizedImportItem {
  return {
    sourceExternalId: externalId,
    sourceModifiedAt: "2026-08-01T10:00:00.000Z",
    contentHash: hashImportContent({ externalId, body }),
    snapshot: {
      schemaVersion: 1,
      type: "NOTE",
      title: `Doc ${externalId}`,
      body: { format: "plain_text", content: body },
      tags: [],
      customFields: { source: { provider: "GOOGLE_DRIVE", externalId } }
    }
  };
}

/** Deterministic provider: returns scripted pages, optionally failing on a given call. */
function fakeProvider(pages: ImportBatch[], options: { failOnCall?: number } = {}): ImportProvider & { calls: number } {
  const state = {
    provider: "GOOGLE_DRIVE" as const,
    calls: 0,
    async discover() {
      return { provider: "GOOGLE_DRIVE" as const, estimatedItems: null, scopes: [] };
    },
    async fetchBatch(cursor?: string | null): Promise<ImportBatch> {
      state.calls += 1;
      if (options.failOnCall === state.calls) throw new Error("provider exploded");
      const index = cursor ? Number(cursor) : 0;
      return pages[index] ?? { items: [], nextCursor: null };
    }
  };
  return state;
}

integration("import repository", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
  }, 30_000);

  afterAll(async () => client?.close());

  it("is idempotent, resumable, and private by default", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const objectsRepository = createObjectRepository(client);
    const importsRepository = createImportRepository(client);

    const ownerA = randomUUID();
    const ownerB = randomUUID();
    await objectsRepository.provisionUser({ id: ownerA, username: username(ownerA), email: null });
    await objectsRepository.provisionUser({ id: ownerB, username: username(ownerB), email: null });

    const pageOne = { items: [item("d1", "alpha"), item("d2", "beta")], nextCursor: "1" };
    const pageTwo = { items: [item("d3", "gamma")], nextCursor: null };

    // First run walks both pages and imports every record.
    const first = await importsRepository.start(ownerA, "GOOGLE_DRIVE");
    const provider = fakeProvider([pageOne, pageTwo]);
    const afterPageOne = await importsRepository.runBatch(ownerA, first.id, provider);
    expect(afterPageOne.done).toBe(false);
    expect(afterPageOne.import.cursorState).toEqual({ cursor: "1" });
    const afterPageTwo = await importsRepository.runBatch(ownerA, first.id, provider);
    expect(afterPageTwo.done).toBe(true);
    expect(afterPageTwo.import.status).toBe("COMPLETED");
    expect(afterPageTwo.import.importedCount).toBe(3);
    expect(afterPageTwo.import.skippedCount).toBe(0);

    // Imported objects are PRIVATE and attributed to IMPORT.
    const listed = await objectsRepository.list(ownerA, 100);
    expect(listed).toHaveLength(3);
    expect(listed.every((entry) => entry.object.visibility === "PRIVATE")).toBe(true);
    expect(listed.every((entry) => entry.currentRevision.createdByType === "IMPORT")).toBe(true);

    // A finished run cannot be advanced again.
    await expect(importsRepository.runBatch(ownerA, first.id, provider)).rejects.toThrow(ImportStateError);

    // Re-importing the same unchanged sources creates zero duplicate objects.
    const second = await importsRepository.start(ownerA, "GOOGLE_DRIVE");
    const replay = fakeProvider([pageOne, pageTwo]);
    await importsRepository.runBatch(ownerA, second.id, replay);
    const replayed = await importsRepository.runBatch(ownerA, second.id, replay);
    expect(replayed.import.status).toBe("COMPLETED");
    expect(replayed.import.skippedCount).toBe(3);
    expect(replayed.import.importedCount).toBe(0);
    expect(await objectsRepository.list(ownerA, 100)).toHaveLength(3);

    // A changed source updates in place and appends a revision rather than duplicating.
    const changed = { items: [item("d1", "alpha revised")], nextCursor: null };
    const third = await importsRepository.start(ownerA, "GOOGLE_DRIVE");
    const updated = await importsRepository.runBatch(ownerA, third.id, fakeProvider([changed]));
    expect(updated.import.importedCount).toBe(1);
    expect(await objectsRepository.list(ownerA, 100)).toHaveLength(3);
    const target = (await objectsRepository.list(ownerA, 100)).find((entry) => entry.object.title === "Doc d1");
    expect(target).toBeDefined();
    const revisions = await objectsRepository.revisions(ownerA, target?.object.id ?? "");
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    expect(revisions[0]?.createdByType).toBe("IMPORT");

    // Only one live run per provider is possible.
    const fourth = await importsRepository.start(ownerA, "GOOGLE_DRIVE");
    await expect(importsRepository.start(ownerA, "GOOGLE_DRIVE")).rejects.toThrow(ImportStateError);

    // A provider failure fails the run but preserves its cursor, and resume continues from there.
    await expect(importsRepository.runBatch(ownerA, fourth.id, fakeProvider([pageOne], { failOnCall: 1 }))).rejects.toThrow(/provider exploded/);
    const failed = await importsRepository.get(ownerA, fourth.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.errorSummary?.errors.at(-1)?.message).toContain("provider exploded");

    const reopened = await importsRepository.resume(ownerA, fourth.id);
    expect(reopened.status).toBe("RUNNING");
    expect(reopened.completedAt).toBeNull();
    const recovered = await importsRepository.runBatch(ownerA, fourth.id, fakeProvider([pageOne, pageTwo]));
    expect(recovered.import.status).toBe("RUNNING");
    await expect(importsRepository.resume(ownerA, fourth.id)).rejects.toThrow(ImportStateError);

    // Import runs are private to their owner.
    await expect(importsRepository.get(ownerB, fourth.id)).rejects.toThrow(ImportNotFoundError);
    expect(await importsRepository.list(ownerB)).toHaveLength(0);
    expect(await objectsRepository.list(ownerB, 100)).toHaveLength(0);
  }, 60_000);
});
