import { describe, expect, it } from "vitest";
import {
  StorageValidationError,
  createInMemoryStorage,
  deriveStorageKey,
  sanitizeFilename,
  storageKeyOwnerId,
  uploadIntentInputSchema,
  validateUpload
} from "../src/index";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherOwnerId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const intent = { objectId: "44444444-4444-4444-8444-444444444444", filename: "notes.pdf", mimeType: "application/pdf", byteSize: 1_024 };

describe("upload validation", () => {
  it("accepts an allowlisted type and returns its category", () => {
    expect(validateUpload(intent)).toMatchObject({ category: "DOCUMENT", extension: "pdf", filename: "notes.pdf" });
  });

  it("rejects a content type outside the allowlist", () => {
    expect(() => validateUpload({ ...intent, filename: "payload.svg", mimeType: "image/svg+xml" })).toThrow(StorageValidationError);
  });

  it("rejects a payload larger than the per-type limit", () => {
    expect(() => validateUpload({ ...intent, byteSize: 26 * 1_024 * 1_024 })).toThrow(/limited to 25 MB/);
  });

  it("rejects an extension that disagrees with the declared content type", () => {
    expect(() => validateUpload({ ...intent, filename: "notes.exe" })).toThrow(/must use one of these extensions/);
  });

  it("caps byteSize at the schema boundary before any rule runs", () => {
    expect(uploadIntentInputSchema.safeParse({ ...intent, byteSize: 1_024 * 1_024 * 1_024 }).success).toBe(false);
  });
});

describe("filename sanitisation", () => {
  it("drops directory traversal components", () => {
    expect(sanitizeFilename("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFilename("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });

  it("removes control characters and collapses unsafe characters", () => {
    expect(sanitizeFilename("we ird\u0000 name.png")).toBe("we_ird_name.png");
  });

  it("requires an extension", () => {
    expect(() => sanitizeFilename("passwd")).toThrow(StorageValidationError);
    expect(() => sanitizeFilename("...")).toThrow(StorageValidationError);
  });

  it("truncates a long name but keeps its extension", () => {
    const result = sanitizeFilename(`${"a".repeat(400)}.png`);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith(".png")).toBe(true);
  });
});

describe("storage key derivation", () => {
  it("prefixes every key with the owner id", () => {
    expect(deriveStorageKey({ ownerId, fileId, filename: "notes.pdf" })).toBe(`${ownerId}/${fileId}/notes.pdf`);
  });

  it("cannot be steered out of the owner prefix by a crafted filename", () => {
    const key = deriveStorageKey({ ownerId, fileId, filename: `../../${otherOwnerId}/steal.pdf` });
    expect(key).toBe(`${ownerId}/${fileId}/steal.pdf`);
    expect(storageKeyOwnerId(key)).toBe(ownerId);
  });

  it("refuses non-UUID identifiers", () => {
    expect(() => deriveStorageKey({ ownerId: "not-a-uuid", fileId, filename: "notes.pdf" })).toThrow(StorageValidationError);
  });
});

describe("in-memory adapter", () => {
  it("issues an upload ticket then a download ticket for the stored key", async () => {
    const storage = createInMemoryStorage({ now: () => 0 });
    const key = deriveStorageKey({ ownerId, fileId, filename: "clip.webm" });
    const upload = await storage.createUploadUrl({ key, mimeType: "audio/webm" });
    expect(upload.method).toBe("PUT");
    expect(upload.expiresAt).toBe(new Date(900_000).toISOString());
    await expect(storage.createDownloadUrl({ key })).resolves.toMatchObject({ url: expect.stringContaining("memory://download/") });
  });

  it("refuses a key that is not owner prefixed", async () => {
    const storage = createInMemoryStorage();
    await expect(storage.createUploadUrl({ key: "public/anything.pdf", mimeType: "application/pdf" })).rejects.toThrow(StorageValidationError);
  });

  it("stops serving a removed object", async () => {
    const storage = createInMemoryStorage();
    const key = deriveStorageKey({ ownerId, fileId, filename: "notes.pdf" });
    await storage.createUploadUrl({ key, mimeType: "application/pdf" });
    await storage.remove(key);
    await expect(storage.createDownloadUrl({ key })).rejects.toThrow(StorageValidationError);
  });
});
