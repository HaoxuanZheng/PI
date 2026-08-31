import { z } from "zod";

export class StorageValidationError extends Error { readonly code = "VALIDATION_FAILED"; }

export type FileCategory = "DOCUMENT" | "IMAGE" | "AUDIO";
export type MimeRule = { category: FileCategory; extensions: readonly string[]; maxBytes: number };

const MEGABYTE = 1_024 * 1_024;

/** Uploads are an allowlist. An unlisted content type is rejected before a storage key exists. */
export const allowedMimeTypes: Readonly<Record<string, MimeRule>> = {
  "text/plain": { category: "DOCUMENT", extensions: ["txt"], maxBytes: 25 * MEGABYTE },
  "text/markdown": { category: "DOCUMENT", extensions: ["md", "markdown"], maxBytes: 25 * MEGABYTE },
  "application/pdf": { category: "DOCUMENT", extensions: ["pdf"], maxBytes: 25 * MEGABYTE },
  "image/png": { category: "IMAGE", extensions: ["png"], maxBytes: 15 * MEGABYTE },
  "image/jpeg": { category: "IMAGE", extensions: ["jpg", "jpeg"], maxBytes: 15 * MEGABYTE },
  "image/webp": { category: "IMAGE", extensions: ["webp"], maxBytes: 15 * MEGABYTE },
  "audio/webm": { category: "AUDIO", extensions: ["webm"], maxBytes: 50 * MEGABYTE },
  "audio/mpeg": { category: "AUDIO", extensions: ["mp3"], maxBytes: 50 * MEGABYTE },
  "audio/mp4": { category: "AUDIO", extensions: ["m4a", "mp4"], maxBytes: 50 * MEGABYTE },
  "audio/wav": { category: "AUDIO", extensions: ["wav"], maxBytes: 50 * MEGABYTE }
};

export const maxUploadBytes = Math.max(...Object.values(allowedMimeTypes).map((rule) => rule.maxBytes));

export const uploadIntentInputSchema = z.object({
  objectId: z.uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150).toLowerCase(),
  byteSize: z.number().int().min(1).max(maxUploadBytes)
});

export const completeUploadInputSchema = z.object({
  checksum: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/, "checksum must be a hex SHA-256 digest"),
  byteSize: z.number().int().min(1).max(maxUploadBytes)
});

export type UploadIntentInput = z.infer<typeof uploadIntentInputSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadInputSchema>;
export type ValidatedUpload = { filename: string; extension: string; mimeType: string; byteSize: number; category: FileCategory; maxBytes: number };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fileExtension(filename: string) {
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(index + 1).toLowerCase() : "";
}

/** Strips directory components and control characters so a client can never influence the storage path. */
export function sanitizeFilename(filename: string) {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[._]+/, "")
    .replace(/_{2,}/g, "_");
  const extension = fileExtension(cleaned);
  if (!cleaned || !extension) throw new StorageValidationError("A file name with an extension is required");
  if (cleaned.length <= 120) return cleaned;
  const stem = cleaned.slice(0, 120 - extension.length - 1).replace(/[._]+$/, "");
  if (!stem) throw new StorageValidationError("A file name with an extension is required");
  return `${stem}.${extension}`;
}

export function validateUpload(input: UploadIntentInput): ValidatedUpload {
  const rule = allowedMimeTypes[input.mimeType];
  if (!rule) throw new StorageValidationError(`${input.mimeType} is not an accepted content type`);
  if (input.byteSize > rule.maxBytes) {
    throw new StorageValidationError(`${input.mimeType} uploads are limited to ${Math.floor(rule.maxBytes / MEGABYTE)} MB`);
  }
  const filename = sanitizeFilename(input.filename);
  const extension = fileExtension(filename);
  if (!rule.extensions.includes(extension)) {
    throw new StorageValidationError(`A ${input.mimeType} upload must use one of these extensions: ${rule.extensions.join(", ")}`);
  }
  return { filename, extension, mimeType: input.mimeType, byteSize: input.byteSize, category: rule.category, maxBytes: rule.maxBytes };
}

/**
 * Storage keys are always derived on the server and always prefixed with the owner id, so one
 * user's upload can never address or overwrite another user's stored bytes.
 */
export function deriveStorageKey(input: { ownerId: string; fileId: string; filename: string }) {
  if (!uuidPattern.test(input.ownerId) || !uuidPattern.test(input.fileId)) {
    throw new StorageValidationError("Storage keys require UUID owner and file identifiers");
  }
  return `${input.ownerId.toLowerCase()}/${input.fileId.toLowerCase()}/${sanitizeFilename(input.filename)}`;
}

export function storageKeyOwnerId(key: string) {
  const prefix = key.split("/")[0] ?? "";
  return uuidPattern.test(prefix) ? prefix : null;
}

export type UploadTicket = { url: string; method: "PUT"; headers: Record<string, string>; token: string | null; expiresAt: string };
export type DownloadTicket = { url: string; expiresAt: string };

export type StoragePort = {
  readonly name: string;
  createUploadUrl(input: { key: string; mimeType: string; expiresInSeconds?: number }): Promise<UploadTicket>;
  createDownloadUrl(input: { key: string; expiresInSeconds?: number }): Promise<DownloadTicket>;
  remove(key: string): Promise<void>;
};

export const defaultUploadExpirySeconds = 900;
export const defaultDownloadExpirySeconds = 300;

export function expiresAt(seconds: number, now: () => number = Date.now) {
  return new Date(now() + seconds * 1_000).toISOString();
}

/** Deterministic adapter for tests and local development. It never leaves the process. */
export function createInMemoryStorage(options: { now?: () => number } = {}): StoragePort & { objects: Map<string, { mimeType: string }> } {
  const objects = new Map<string, { mimeType: string }>();
  const now = options.now ?? Date.now;
  return {
    name: "in-memory",
    objects,
    async createUploadUrl({ key, mimeType, expiresInSeconds = defaultUploadExpirySeconds }) {
      if (!storageKeyOwnerId(key)) throw new StorageValidationError("Storage keys must be owner prefixed");
      objects.set(key, { mimeType });
      return {
        url: `memory://upload/${encodeURIComponent(key)}`,
        method: "PUT",
        headers: { "content-type": mimeType },
        token: null,
        expiresAt: expiresAt(expiresInSeconds, now)
      };
    },
    async createDownloadUrl({ key, expiresInSeconds = defaultDownloadExpirySeconds }) {
      if (!objects.has(key)) throw new StorageValidationError("The stored object does not exist");
      return { url: `memory://download/${encodeURIComponent(key)}`, expiresAt: expiresAt(expiresInSeconds, now) };
    },
    async remove(key) {
      objects.delete(key);
    }
  };
}
