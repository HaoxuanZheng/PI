import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readPersonProfile, type ObjectSnapshot } from "@lifegraph/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/index";
import { createObjectRepository } from "../src/repositories/objects";
import {
  createEntityRepository,
  MergeCandidateStateError,
  MergeNotApplicableError
} from "../src/repositories/entities";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

const username = (id: string) => `u${id.replaceAll("-", "").slice(0, 12)}`;

function personSnapshot(person: Record<string, unknown>, source?: { provider: string; externalId: string }): ObjectSnapshot {
  return {
    schemaVersion: 1,
    type: "PERSON",
    title: String(person["displayName"]),
    tags: [],
    customFields: { person, ...(source ? { source } : {}) }
  };
}

const base = { organization: "Example Labs", role: null, phones: [], interests: [] };

integration("entity resolution repository", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
  }, 30_000);

  afterAll(async () => client?.close());

  it("proposes duplicates deterministically and only merges when told", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const objectsRepository = createObjectRepository(client);
    const entities = createEntityRepository(client);

    const ownerA = randomUUID();
    const ownerB = randomUUID();
    await objectsRepository.provisionUser({ id: ownerA, username: username(ownerA), email: null });
    await objectsRepository.provisionUser({ id: ownerB, username: username(ownerB), email: null });

    // Two records for the same person, agreeing on email, plus an unrelated person.
    const left = await objectsRepository.create(ownerA, {
      snapshot: personSnapshot({ ...base, displayName: "Alex Chen", emails: ["alex@example.com"] }),
      visibility: "PRIVATE"
    });
    const right = await objectsRepository.create(ownerA, {
      snapshot: personSnapshot({ ...base, displayName: "A. Chen", organization: null, emails: ["ALEX@example.com"], phones: ["212-555-0147"] }, { provider: "GOOGLE_CONTACTS", externalId: "people/c1" }),
      visibility: "PRIVATE"
    });
    await objectsRepository.create(ownerA, {
      snapshot: personSnapshot({ ...base, displayName: "Sam Patel", organization: "Other Co", emails: ["sam@other.com"] }),
      visibility: "PRIVATE"
    });
    // A different owner's identical person must never be proposed against ownerA's records.
    await objectsRepository.create(ownerB, {
      snapshot: personSnapshot({ ...base, displayName: "Alex Chen", emails: ["alex@example.com"] }),
      visibility: "PRIVATE"
    });

    const detected = await entities.detect(ownerA);
    expect(detected.compared).toBe(3);
    expect(detected.created).toBe(1);
    expect(detected.truncated).toBe(false);

    const candidates = await entities.listCandidates(ownerA);
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate?.signals).toContain("EMAIL");
    expect(candidate?.confidence).toBe("HIGH");
    expect(Number(candidate?.score)).toBeCloseTo(0.9, 3);
    // The pair is stored in canonical order regardless of creation order.
    expect([candidate?.leftObjectId, candidate?.rightObjectId].sort()).toEqual([left.object.id, right.object.id].sort());

    // Detection is idempotent: re-running proposes nothing new.
    expect((await entities.detect(ownerA)).created).toBe(0);
    expect(await entities.listCandidates(ownerA)).toHaveLength(1);

    // Another user cannot see or decide this candidate.
    expect(await entities.listCandidates(ownerB)).toHaveLength(0);

    // A merge target must be one of the pair.
    await expect(entities.merge(ownerA, candidate?.id ?? "", (await objectsRepository.list(ownerA, 100))[0]?.object.id ?? ""))
      .rejects.toThrow(MergeNotApplicableError);

    // Merge into the left record: it absorbs contact detail, the source is soft-deleted.
    const merged = await entities.merge(ownerA, candidate?.id ?? "", left.object.id);
    expect(merged.merge.targetObjectId).toBe(left.object.id);
    expect(merged.merge.sourceObjectId).toBe(right.object.id);
    expect(merged.merge.targetRevisionBefore).toBe(left.currentRevision.id);
    expect(merged.merge.targetRevisionAfter).toBe(merged.targetRevisionId);

    const survivor = await objectsRepository.get(ownerA, left.object.id);
    const profile = readPersonProfile(survivor.currentRevision.snapshot as ObjectSnapshot);
    expect(profile?.displayName).toBe("Alex Chen");
    expect(profile?.organization).toBe("Example Labs");
    expect(profile?.emails).toEqual(["alex@example.com", "ALEX@example.com"]);
    expect(profile?.phones).toEqual(["212-555-0147"]);

    // The merged-away record is gone from live reads but keeps its history.
    const remaining = await objectsRepository.list(ownerA, 100);
    expect(remaining.map((entry) => entry.object.id)).not.toContain(right.object.id);
    expect((await objectsRepository.revisions(ownerA, right.object.id)).length).toBeGreaterThanOrEqual(2);

    // The merge is auditable and the candidate cannot be decided twice.
    expect(await entities.listMerges(ownerA)).toHaveLength(1);
    await expect(entities.merge(ownerA, candidate?.id ?? "", left.object.id)).rejects.toThrow(MergeCandidateStateError);
    expect(await entities.listCandidates(ownerA)).toHaveLength(0);

    // "Keep separate" is durable: the pair is never proposed again.
    const keepLeft = await objectsRepository.create(ownerA, {
      snapshot: personSnapshot({ ...base, displayName: "Jordan Lee", emails: ["jordan@example.com"] }),
      visibility: "PRIVATE"
    });
    await objectsRepository.create(ownerA, {
      snapshot: personSnapshot({ ...base, displayName: "Jordan Lee", emails: ["jordan@example.com"] }),
      visibility: "PRIVATE"
    });
    await entities.detect(ownerA);
    const jordan = (await entities.listCandidates(ownerA)).find((entry) =>
      entry.leftObjectId === keepLeft.object.id || entry.rightObjectId === keepLeft.object.id);
    expect(jordan).toBeDefined();
    await entities.separate(ownerA, jordan?.id ?? "");
    expect((await entities.detect(ownerA)).created).toBe(0);
    expect(await entities.listCandidates(ownerA)).toHaveLength(0);
    await expect(entities.separate(ownerA, jordan?.id ?? "")).rejects.toThrow(MergeCandidateStateError);
  }, 60_000);
});
