import { z } from "zod";

export const objectTypeSchema = z.enum([
  "NOTE",
  "IDEA",
  "PROJECT",
  "PERSON",
  "EXPERIENCE",
  "SKILL",
  "FILE",
  "PHOTO",
  "VOICE_NOTE",
  "EVENT",
  "CREDENTIAL",
  "GENERIC"
]);

export const visibilitySchema = z.enum(["PRIVATE", "PUBLIC"]);
export const usernameSchema = z.string().trim().toLowerCase().regex(
  /^[a-z0-9][a-z0-9_-]{2,29}$/,
  "Use 3–30 lowercase letters, numbers, underscores, or hyphens"
);

export const editorBlockSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["paragraph", "heading", "bullet"]),
  text: z.string().max(100_000)
});

const richTextBodySchema = z.union([
  z.object({ format: z.literal("plain_text"), content: z.string().max(1_000_000) }),
  z.object({ format: z.literal("richtext"), content: z.array(editorBlockSchema).min(1).max(20_000) })
]);

export const objectSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  type: objectTypeSchema,
  title: z.string().trim().min(1).max(300).nullable().optional(),
  summary: z.string().trim().max(2_000).nullable().optional(),
  body: richTextBodySchema.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  customFields: z.record(z.string(), z.unknown()).default({})
});

export const createObjectInputSchema = z.object({
  snapshot: objectSnapshotSchema,
  visibility: visibilitySchema.default("PRIVATE"),
  observedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  effectiveFrom: z.iso.datetime({ offset: true }).nullable().optional(),
  effectiveTo: z.iso.datetime({ offset: true }).nullable().optional()
}).refine(
  ({ effectiveFrom, effectiveTo }) => !effectiveFrom || !effectiveTo || effectiveFrom <= effectiveTo,
  { message: "effectiveFrom must not be after effectiveTo", path: ["effectiveTo"] }
);

export const updateObjectInputSchema = z.object({
  expectedRevisionId: z.uuid(),
  snapshot: objectSnapshotSchema,
  visibility: visibilitySchema.optional(),
  observedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  effectiveFrom: z.iso.datetime({ offset: true }).nullable().optional(),
  effectiveTo: z.iso.datetime({ offset: true }).nullable().optional()
}).refine(
  ({ effectiveFrom, effectiveTo }) => !effectiveFrom || !effectiveTo || effectiveFrom <= effectiveTo,
  { message: "effectiveFrom must not be after effectiveTo", path: ["effectiveTo"] }
);

export const restoreRevisionInputSchema = z.object({
  revisionId: z.uuid(),
  expectedRevisionId: z.uuid()
});

export type ObjectType = z.infer<typeof objectTypeSchema>;
export type ObjectVisibility = z.infer<typeof visibilitySchema>;
export type ObjectSnapshot = z.infer<typeof objectSnapshotSchema>;
export type EditorBlock = z.infer<typeof editorBlockSchema>;
export type CreateObjectInput = z.infer<typeof createObjectInputSchema>;
export type UpdateObjectInput = z.infer<typeof updateObjectInputSchema>;
export type RestoreRevisionInput = z.infer<typeof restoreRevisionInputSchema>;

export type CreatedByType = "USER" | "AI_ACCEPTED" | "IMPORT" | "SYSTEM_MIGRATION" | "RESTORE";
export type ChangeType = "CREATE" | "UPDATE" | "RESTORE" | "DELETE";

export type SnapshotDiff = {
  title: { before: string | null; after: string | null } | null;
  summary: { before: string | null; after: string | null } | null;
  tags: { before: string[]; after: string[] } | null;
  body: Array<{ kind: "added" | "removed" | "changed"; before?: EditorBlock; after?: EditorBlock }>;
};

export function snapshotBlocks(snapshot: ObjectSnapshot): EditorBlock[] {
  if (!snapshot.body) return [{ id: "body-1", type: "paragraph", text: "" }];
  if (snapshot.body.format === "richtext") return snapshot.body.content;
  return snapshot.body.content.split("\n").map((text, index) => ({ id: `legacy-${index + 1}`, type: "paragraph", text }));
}

export function diffSnapshots(before: ObjectSnapshot, after: ObjectSnapshot): SnapshotDiff {
  const beforeBlocks = snapshotBlocks(before);
  const afterBlocks = snapshotBlocks(after);
  const body: SnapshotDiff["body"] = [];
  const count = Math.max(beforeBlocks.length, afterBlocks.length);
  for (let index = 0; index < count; index += 1) {
    const previous = beforeBlocks[index];
    const next = afterBlocks[index];
    if (!previous && next) body.push({ kind: "added", after: next });
    else if (previous && !next) body.push({ kind: "removed", before: previous });
    else if (previous && next && (previous.type !== next.type || previous.text !== next.text)) {
      body.push({ kind: "changed", before: previous, after: next });
    }
  }
  const field = <T>(previous: T, next: T) => JSON.stringify(previous) === JSON.stringify(next) ? null : { before: previous, after: next };
  return {
    title: field(before.title ?? null, after.title ?? null),
    summary: field(before.summary ?? null, after.summary ?? null),
    tags: field(before.tags, after.tags),
    body
  };
}
