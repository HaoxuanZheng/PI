import { z } from "zod";

export class PrivacyValidationError extends Error { readonly code = "VALIDATION_FAILED"; }

/** Raised when an export bundle would contain a record belonging to another user. */
export class ExportOwnershipError extends Error { readonly code = "EXPORT_OWNERSHIP_VIOLATION"; }

export const exportFormatSchema = z.enum(["JSON", "MARKDOWN"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const requestExportInputSchema = z.object({ format: exportFormatSchema.default("JSON") });

/** Deletion is destructive and irreversible after the grace period, so it is confirmed by typing. */
export const requestDeletionInputSchema = z.object({
  confirm: z.literal(true),
  acknowledgement: z.literal("DELETE MY ACCOUNT")
});

export type RequestExportInput = z.infer<typeof requestExportInputSchema>;
export type RequestDeletionInput = z.infer<typeof requestDeletionInputSchema>;

/** Days between a deletion request and the earliest permitted purge. */
export const deletionGraceDays = 7;

export function purgeAfter(requestedAt: Date) {
  return new Date(requestedAt.getTime() + deletionGraceDays * 24 * 60 * 60 * 1_000);
}

export const exportBundleVersion = 1;

/**
 * Every collection an export carries. Named explicitly rather than derived, so adding a table to the
 * schema does not silently start or stop being exported: a new collection must be added here.
 */
export const exportCollections = [
  "objects",
  "revisions",
  "relationships",
  "files",
  "publications",
  "imports",
  "aiOperations",
  "mergeCandidates",
  "merges",
  "grantsIssued",
  "auditEvents"
] as const;

export type ExportCollection = (typeof exportCollections)[number];

export type ExportedUser = {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  timezone: string;
  locale: string;
  accountStatus: string;
  createdAt: string;
};

export type ExportBundle = {
  bundleVersion: number;
  exportedAt: string;
  user: ExportedUser;
  collections: Record<ExportCollection, unknown[]>;
};

/**
 * Records are matched to their owner by whichever column carries it. `object_revisions` has no owner
 * column of its own, so it is verified through the object ids already proven to belong to the user.
 */
const ownerKeys = ["ownerId", "userId", "actorUserId"] as const;

function recordOwner(record: unknown) {
  if (!record || typeof record !== "object") return undefined;
  const entry = record as Record<string, unknown>;
  for (const key of ownerKeys) {
    const value = entry[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Final guard before a bundle leaves the server.
 *
 * An export is the one endpoint that deliberately returns a large slice of the database, so it is
 * checked rather than trusted: any record that does not belong to the requesting user, and any
 * revision belonging to an object outside the bundle, aborts the export.
 */
export function assertBundleOwnership(bundle: ExportBundle, ownerId: string) {
  if (bundle.user.id !== ownerId) throw new ExportOwnershipError("The bundle user does not match the requester");

  const objectIds = new Set<string>();
  for (const record of bundle.collections.objects) {
    const entry = record as Record<string, unknown>;
    if (typeof entry["id"] === "string") objectIds.add(entry["id"]);
  }

  for (const collection of exportCollections) {
    for (const record of bundle.collections[collection]) {
      if (collection === "revisions") {
        const objectId = (record as Record<string, unknown>)["objectId"];
        if (typeof objectId !== "string" || !objectIds.has(objectId)) {
          throw new ExportOwnershipError("A revision does not belong to an exported object");
        }
        continue;
      }
      const owner = recordOwner(record);
      // A record with no owner column at all is treated as a failure, never as acceptable.
      if (owner === undefined) throw new ExportOwnershipError(`A ${collection} record has no owner column`);
      if (owner !== ownerId) throw new ExportOwnershipError(`A ${collection} record belongs to another user`);
    }
  }
  return bundle;
}

export function emptyCollections(): Record<ExportCollection, unknown[]> {
  return Object.fromEntries(exportCollections.map((name) => [name, []])) as Record<ExportCollection, unknown[]>;
}

function escapeMarkdown(value: string) {
  return value.replace(/([|\\`*_{}[\]()#+\-!])/g, "\\$1");
}

/** A human-readable companion to the JSON bundle, not a lossless format. */
export function renderMarkdownExport(bundle: ExportBundle) {
  const lines = [
    `# LifeGraph export for @${bundle.user.username}`,
    "",
    `Exported at: ${bundle.exportedAt}`,
    `Bundle version: ${bundle.bundleVersion}`,
    ""
  ];
  for (const collection of exportCollections) {
    lines.push(`## ${collection} (${bundle.collections[collection].length})`, "");
  }
  lines.push("## Objects", "");
  for (const record of bundle.collections.objects) {
    const entry = record as Record<string, unknown>;
    const title = typeof entry["title"] === "string" && entry["title"] ? entry["title"] : "Untitled";
    lines.push(`- ${escapeMarkdown(title)} (${String(entry["type"] ?? "GENERIC")})`);
  }
  lines.push("", "The JSON bundle is authoritative and contains full revision history.", "");
  return lines.join("\n");
}
