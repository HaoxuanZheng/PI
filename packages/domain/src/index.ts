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

const richTextBodySchema = z.object({
  format: z.enum(["plain_text", "richtext"]),
  content: z.union([z.string().max(1_000_000), z.array(z.unknown()).max(20_000)])
});

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
export type CreateObjectInput = z.infer<typeof createObjectInputSchema>;
export type UpdateObjectInput = z.infer<typeof updateObjectInputSchema>;
export type RestoreRevisionInput = z.infer<typeof restoreRevisionInputSchema>;

export type CreatedByType = "USER" | "AI_ACCEPTED" | "IMPORT" | "SYSTEM_MIGRATION" | "RESTORE";
export type ChangeType = "CREATE" | "UPDATE" | "RESTORE" | "DELETE";
