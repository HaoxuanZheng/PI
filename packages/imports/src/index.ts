import { createHash } from "node:crypto";
import { objectSnapshotSchema } from "@lifegraph/domain";
import { z } from "zod";

export class ImportValidationError extends Error { readonly code = "VALIDATION_FAILED"; }

export const importProviderSchema = z.enum(["GOOGLE_DRIVE", "NOTION", "GOOGLE_CONTACTS"]);
export const importStatusSchema = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]);

/**
 * One external record, already mapped onto a LifeGraph snapshot. `contentHash` is what makes an
 * import idempotent: re-importing an unchanged source produces the same hash and is skipped.
 */
export const normalizedImportItemSchema = z.object({
  sourceExternalId: z.string().trim().min(1).max(500),
  sourceModifiedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  contentHash: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/, "contentHash must be a hex SHA-256 digest"),
  snapshot: objectSnapshotSchema
});

export const startImportInputSchema = z.object({ provider: importProviderSchema });

export type ImportProviderName = z.infer<typeof importProviderSchema>;
export type ImportStatus = z.infer<typeof importStatusSchema>;
export type NormalizedImportItem = z.infer<typeof normalizedImportItemSchema>;
export type StartImportInput = z.infer<typeof startImportInputSchema>;

export type ImportManifest = { provider: ImportProviderName; estimatedItems: number | null; scopes: readonly string[] };
export type ImportBatch = { items: NormalizedImportItem[]; nextCursor: string | null };

/** Providers only read and normalise. They never write to the database and never set visibility. */
export type ImportProvider = {
  readonly provider: ImportProviderName;
  discover(): Promise<ImportManifest>;
  fetchBatch(cursor?: string | null): Promise<ImportBatch>;
};

/** Canonical JSON so that key order can never change a hash. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function hashImportContent(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)) ?? "null").digest("hex");
}

export type ImportAction = "CREATE" | "UPDATE" | "SKIP";
export type ExistingImportedObject = { objectId: string; contentHash: string | null } | null;

/**
 * The idempotency decision, kept pure so it is testable without a database.
 *
 * An unchanged source is skipped rather than rewritten, which is what keeps a repeated import from
 * creating duplicate objects or revision noise.
 */
export function decideImportAction(existing: ExistingImportedObject, incoming: { contentHash: string }): ImportAction {
  if (!existing) return "CREATE";
  if (existing.contentHash === incoming.contentHash) return "SKIP";
  return "UPDATE";
}

export type ImportCounters = { imported: number; skipped: number; errors: number };

export function emptyCounters(): ImportCounters {
  return { imported: 0, skipped: 0, errors: 0 };
}

export function applyAction(counters: ImportCounters, action: ImportAction | "ERROR"): ImportCounters {
  if (action === "SKIP") return { ...counters, skipped: counters.skipped + 1 };
  if (action === "ERROR") return { ...counters, errors: counters.errors + 1 };
  return { ...counters, imported: counters.imported + 1 };
}

/** Rejects duplicate external ids inside a single batch before they reach the database. */
export function dedupeBatch(items: readonly NormalizedImportItem[]) {
  const seen = new Set<string>();
  const unique: NormalizedImportItem[] = [];
  let duplicates = 0;
  for (const item of items) {
    if (seen.has(item.sourceExternalId)) {
      duplicates += 1;
      continue;
    }
    seen.add(item.sourceExternalId);
    unique.push(item);
  }
  return { unique, duplicates };
}
