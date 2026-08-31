import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createInMemoryStorage } from "@lifegraph/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/index";
import { createObjectRepository } from "../src/repositories/objects";
import { createPermissionRepository, PermissionDeniedError } from "../src/repositories/permissions";
import { createFileRepository, FileNotFoundError, FileStateError } from "../src/repositories/files";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

const snapshot = { schemaVersion: 1 as const, type: "FILE" as const, title: "Attachment holder", tags: [], customFields: {} };
const checksum = "a".repeat(64);
const username = (id: string) => `u${id.replaceAll("-", "").slice(0, 12)}`;

integration("file repository", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
  }, 30_000);

  afterAll(async () => client?.close());

  it("enforces ownership, scan gating, and deletion propagation", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const objectsRepository = createObjectRepository(client);
    const permissions = createPermissionRepository(client);
    const storage = createInMemoryStorage();
    const files = createFileRepository(client, storage);
    const filesWithoutScanGate = createFileRepository(client, storage, { requireCleanScan: false });

    const ownerA = randomUUID();
    const ownerB = randomUUID();
    await objectsRepository.provisionUser({ id: ownerA, username: username(ownerA), email: null });
    await objectsRepository.provisionUser({ id: ownerB, username: username(ownerB), email: null });
    const created = await objectsRepository.create(ownerA, { snapshot, visibility: "PRIVATE" });
    const objectId = created.object.id;

    // An upload intent reserves an owner-prefixed key and stays PENDING until confirmed.
    const intent = await files.createIntent(ownerA, { objectId, filename: "../../etc/report.pdf", mimeType: "application/pdf", byteSize: 2_048 });
    expect(intent.file.storageKey.startsWith(`${ownerA}/`)).toBe(true);
    expect(intent.file.originalFilename).toBe("report.pdf");
    expect(intent.file.uploadStatus).toBe("PENDING");

    // Unconfirmed bytes are never downloadable.
    await expect(files.createDownloadUrl(ownerA, intent.file.id)).rejects.toThrow(FileStateError);

    // A second user cannot attach to, read, or delete another user's object or file.
    await expect(files.createIntent(ownerB, { objectId, filename: "theirs.pdf", mimeType: "application/pdf", byteSize: 10 }))
      .rejects.toThrow(PermissionDeniedError);
    await expect(files.get(ownerB, intent.file.id)).rejects.toThrow(FileNotFoundError);
    await expect(files.softDelete(ownerB, intent.file.id)).rejects.toThrow(FileNotFoundError);

    // Completion must agree with the reserved size.
    await expect(files.complete(ownerA, intent.file.id, { checksum, byteSize: 4_096 })).rejects.toThrow(FileStateError);
    const stored = await files.complete(ownerA, intent.file.id, { checksum, byteSize: 2_048 });
    expect(stored.uploadStatus).toBe("STORED");
    expect(stored.scanStatus).toBe("PENDING");
    await expect(files.complete(ownerA, intent.file.id, { checksum, byteSize: 2_048 })).rejects.toThrow(FileStateError);

    // Scan gating: PENDING blocks a signed URL, CLEAN releases it, INFECTED blocks it again.
    await expect(files.createDownloadUrl(ownerA, intent.file.id)).rejects.toThrow(FileStateError);
    await expect(filesWithoutScanGate.createDownloadUrl(ownerA, intent.file.id)).resolves.toMatchObject({ download: { url: expect.any(String) } });
    await files.recordScanResult(ownerA, intent.file.id, "CLEAN");
    await expect(files.createDownloadUrl(ownerA, intent.file.id)).resolves.toMatchObject({ download: { url: expect.any(String) } });
    await files.recordScanResult(ownerA, intent.file.id, "INFECTED");
    await expect(files.createDownloadUrl(ownerA, intent.file.id)).rejects.toThrow(FileStateError);
    await files.recordScanResult(ownerA, intent.file.id, "CLEAN");

    // A READ grant shares the attachment list without granting attach rights.
    await permissions.grant(ownerA, objectId, { principalType: "USER", principalId: ownerB, capability: "READ" });
    expect(await files.listForObject(ownerB, objectId)).toHaveLength(1);
    await expect(files.createIntent(ownerB, { objectId, filename: "theirs.pdf", mimeType: "application/pdf", byteSize: 10 }))
      .rejects.toThrow(PermissionDeniedError);

    // Deleting the file removes the stored bytes as well as the record.
    await files.softDelete(ownerA, intent.file.id);
    expect(storage.objects.has(intent.file.storageKey)).toBe(false);
    await expect(files.get(ownerA, intent.file.id)).rejects.toThrow(FileNotFoundError);
    expect(await files.listForObject(ownerA, objectId)).toHaveLength(0);

    // Soft-deleting the owning object cascades to its remaining attachments.
    const second = await files.createIntent(ownerA, { objectId, filename: "clip.webm", mimeType: "audio/webm", byteSize: 512 });
    await files.complete(ownerA, second.file.id, { checksum: "b".repeat(64), byteSize: 512 });
    const current = await objectsRepository.get(ownerA, objectId);
    await objectsRepository.softDelete(ownerA, objectId, current.currentRevision.id);
    await expect(files.get(ownerA, second.file.id)).rejects.toThrow(FileNotFoundError);
    expect(await files.purgeDeleted(ownerA)).toMatchObject({ purged: expect.any(Number) });
    expect(storage.objects.has(second.file.storageKey)).toBe(false);
  }, 60_000);
});
