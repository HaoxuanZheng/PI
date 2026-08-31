import { snapshotBlocks, usernameSchema, type ObjectSnapshot, type ObjectType } from "@lifegraph/domain";
import { z } from "zod";

export class PublicationValidationError extends Error { readonly code = "VALIDATION_FAILED"; }

export const publicationTypeSchema = z.enum(["PROFILE", "PROFESSIONAL", "OBJECT"]);
export const publicationStatusSchema = z.enum(["PUBLISHED", "UNPUBLISHED"]);
export const publicationSectionTypeSchema = z.enum(["EXPERIENCE", "PROJECT", "SKILL", "CREDENTIAL", "NOTE", "IDEA"]);

export type PublicationType = z.infer<typeof publicationTypeSchema>;
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;
export type PublicationSectionType = z.infer<typeof publicationSectionTypeSchema>;

export const slugSchema = z.string().trim().toLowerCase().regex(
  /^[a-z0-9][a-z0-9-]{1,79}$/,
  "Use 2-80 lowercase letters, numbers, or hyphens"
);

/**
 * The only snapshot fields a public projection may ever contain.
 *
 * This is an allowlist, never a denylist: a field added to the snapshot contract in future is
 * private by default and stays private until it is deliberately added here. `customFields` is
 * absent by construction, because it carries person emails, phone numbers, and raw provider
 * metadata that must never reach an anonymous reader.
 */
export const publicObjectFields = ["title", "summary", "body", "tags"] as const;
export type PublicObjectField = (typeof publicObjectFields)[number];

/** Fields that must never be projected, even if a caller names them explicitly. */
const forbiddenFields = new Set(["customFields", "person", "source", "schemaVersion"]);

export const publicObjectFieldSchema = z.enum(publicObjectFields);

export type PublicObjectProjection = {
  type: ObjectType;
  title: string | null;
  summary: string | null;
  body: string | null;
  tags: string[];
};

export type PublicSection = { type: PublicationSectionType; heading: string; items: PublicObjectProjection[] };

export type PublicProfileProjection = {
  username: string;
  displayName: string;
  headline: string | null;
  sections: PublicSection[];
};

export type PublicSnapshot =
  | { kind: "OBJECT"; object: PublicObjectProjection }
  | { kind: "PROFILE"; profile: PublicProfileProjection }
  | { kind: "PROFESSIONAL"; profile: PublicProfileProjection };

/** Flattens body blocks to plain text, so block identifiers and structure are not exposed. */
function projectBody(snapshot: ObjectSnapshot) {
  if (!snapshot.body) return null;
  const text = snapshotBlocks(snapshot).map((block) => block.text.trim()).filter(Boolean).join("\n");
  return text || null;
}

/**
 * Projects a private snapshot onto the public shape, including only the requested allowlisted
 * fields. An unknown or forbidden field is a loud failure rather than a silent omission, so a
 * mistake surfaces in tests instead of leaking or quietly dropping content.
 */
export function projectObjectSnapshot(snapshot: ObjectSnapshot, fields: readonly string[]): PublicObjectProjection {
  if (!fields.length) throw new PublicationValidationError("A publication must expose at least one field");
  const selected = new Set<PublicObjectField>();
  for (const field of fields) {
    if (forbiddenFields.has(field)) {
      throw new PublicationValidationError(`${field} can never be published`);
    }
    const parsed = publicObjectFieldSchema.safeParse(field);
    if (!parsed.success) throw new PublicationValidationError(`${field} is not a publishable field`);
    selected.add(parsed.data);
  }

  return {
    type: snapshot.type,
    title: selected.has("title") ? snapshot.title ?? null : null,
    summary: selected.has("summary") ? snapshot.summary ?? null : null,
    body: selected.has("body") ? projectBody(snapshot) : null,
    tags: selected.has("tags") ? [...snapshot.tags] : []
  };
}

export const publishObjectInputSchema = z.object({
  sourceObjectId: z.uuid(),
  slug: slugSchema,
  fields: z.array(z.string().trim().min(1)).min(1).max(publicObjectFields.length),
  expectedRevisionId: z.uuid(),
  // Publication is never implicit. The caller must confirm after seeing a preview.
  confirm: z.literal(true)
});

export const publishProfileInputSchema = z.object({
  publicationType: z.enum(["PROFILE", "PROFESSIONAL"]),
  displayName: z.string().trim().min(1).max(200),
  headline: z.string().trim().max(300).nullable().default(null),
  sections: z.array(z.object({
    type: publicationSectionTypeSchema,
    heading: z.string().trim().min(1).max(120),
    sourceObjectIds: z.array(z.uuid()).min(1).max(50),
    fields: z.array(z.string().trim().min(1)).min(1).max(publicObjectFields.length)
  })).min(1).max(12),
  confirm: z.literal(true)
});

export const previewObjectInputSchema = publishObjectInputSchema.omit({ confirm: true, slug: true, expectedRevisionId: true });
export const previewProfileInputSchema = publishProfileInputSchema.omit({ confirm: true });

export type PublishObjectInput = z.infer<typeof publishObjectInputSchema>;
export type PublishProfileInput = z.infer<typeof publishProfileInputSchema>;

/** Builds the profile projection. Section membership is a view configuration, not a second store. */
export function projectProfile(input: {
  username: string;
  displayName: string;
  headline: string | null;
  sections: ReadonlyArray<{ type: PublicationSectionType; heading: string; fields: readonly string[]; snapshots: readonly ObjectSnapshot[] }>;
}): PublicProfileProjection {
  return {
    username: usernameSchema.parse(input.username),
    displayName: input.displayName,
    headline: input.headline,
    sections: input.sections.map((section) => ({
      type: section.type,
      heading: section.heading,
      items: section.snapshots.map((snapshot) => projectObjectSnapshot(snapshot, section.fields))
    }))
  };
}

/** The canonical public URL for a profile, used for QR and NFC payloads alike. */
export function profileShareUrl(appUrl: string, username: string) {
  return `${appUrl.replace(/\/+$/, "")}/@${usernameSchema.parse(username)}`;
}

export function objectShareUrl(appUrl: string, username: string, slug: string) {
  return `${profileShareUrl(appUrl, username)}/p/${slugSchema.parse(slug)}`;
}

/** Parses a `/@username` path segment. Anything not prefixed with `@` is not a profile handle. */
export function parseProfileHandle(handle: string) {
  if (!handle.startsWith("@")) return null;
  const parsed = usernameSchema.safeParse(handle.slice(1));
  return parsed.success ? parsed.data : null;
}
