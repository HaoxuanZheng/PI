import type { ObjectSnapshot, RelationshipType } from "@lifegraph/domain";
import type { AIPatchProposal, AIContextManifest } from "@lifegraph/ai";
import type { Capability, PrincipalType, ResourceType } from "@lifegraph/permissions";
import type { MatchConfidence, MatchSignal } from "@lifegraph/entities";
import type { ImportProviderName, ImportStatus } from "@lifegraph/imports";
import type { FileCategory } from "@lifegraph/storage";
import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";

export const accountStatusEnum = pgEnum("account_status", ["ACTIVE", "SUSPENDED", "DELETION_PENDING"]);
export const objectTypeEnum = pgEnum("object_type", [
  "NOTE", "IDEA", "PROJECT", "PERSON", "EXPERIENCE", "SKILL", "FILE", "PHOTO",
  "VOICE_NOTE", "EVENT", "CREDENTIAL", "GENERIC"
]);
export const visibilityEnum = pgEnum("visibility", ["PRIVATE", "PUBLIC"]);
export const changeTypeEnum = pgEnum("change_type", ["CREATE", "UPDATE", "RESTORE", "DELETE"]);
export const createdByTypeEnum = pgEnum("created_by_type", ["USER", "AI_ACCEPTED", "IMPORT", "SYSTEM_MIGRATION", "RESTORE"]);
export const capabilityEnum = pgEnum("capability", ["READ", "COMMENT", "EDIT", "COLLABORATE", "SHARE", "ADMIN"]);
export const principalTypeEnum = pgEnum("principal_type", ["USER", "CONNECTION", "GROUP", "LINK", "PUBLIC", "SYSTEM_AI"]);
export const resourceTypeEnum = pgEnum("resource_type", ["OBJECT"]);
export const actorTypeEnum = pgEnum("actor_type", ["USER", "SYSTEM", "SYSTEM_AI"]);
export const relationshipTypeEnum = pgEnum("relationship_type", ["MENTIONS", "RELATED_TO", "PART_OF", "WORKED_ON", "ATTENDED", "KNOWS", "USES_SKILL"]);
export const entityMergeStatusEnum = pgEnum("entity_merge_status", ["PENDING", "MERGED", "SEPARATE"]);
export const entityMatchConfidenceEnum = pgEnum("entity_match_confidence", ["HIGH", "MEDIUM", "LOW"]);
export const importProviderEnum = pgEnum("import_provider", ["GOOGLE_DRIVE", "NOTION", "GOOGLE_CONTACTS"]);
export const importStatusEnum = pgEnum("import_status", ["PENDING", "RUNNING", "COMPLETED", "FAILED"]);
export const fileCategoryEnum = pgEnum("file_category", ["DOCUMENT", "IMAGE", "AUDIO"]);
export const fileUploadStatusEnum = pgEnum("file_upload_status", ["PENDING", "STORED"]);
export const fileScanStatusEnum = pgEnum("file_scan_status", ["PENDING", "CLEAN", "INFECTED", "FAILED"]);
export const fileProcessingStatusEnum = pgEnum("file_processing_status", ["PENDING", "READY", "FAILED"]);
export const aiValidationStatusEnum = pgEnum("ai_validation_status", ["VALID", "INVALID"]);
export const aiUserDecisionEnum = pgEnum("ai_user_decision", ["PENDING", "ACCEPTED", "REJECTED", "MODIFIED", "EXPIRED"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en-US"),
  accountStatus: accountStatusEnum("account_status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [uniqueIndex("users_username_lower_uidx").on(sql`lower(${table.username})`)]);

export const objects = pgTable("objects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  type: objectTypeEnum("type").notNull(),
  title: text("title"),
  summary: text("summary"),
  // The committed migration uses a stronger composite FK: (id, current_revision_id) → (object_id, id).
  currentRevisionId: uuid("current_revision_id"),
  visibility: visibilityEnum("visibility").notNull().default("PRIVATE"),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }),
  effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }),
  effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
  sourceType: text("source_type"),
  sourceExternalId: text("source_external_id"),
  sourceContentHash: text("source_content_hash"),
  sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" })
}, (table) => [
  index("objects_owner_updated_idx").on(table.ownerId, table.updatedAt),
  index("objects_owner_type_idx").on(table.ownerId, table.type),
  uniqueIndex("objects_owner_source_uidx")
    .on(table.ownerId, table.sourceType, table.sourceExternalId)
    .where(sql`${table.deletedAt} IS NULL AND ${table.sourceType} IS NOT NULL AND ${table.sourceExternalId} IS NOT NULL`)
]);

export const objectRevisions = pgTable("object_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  objectId: uuid("object_id").notNull().references(() => objects.id, { onDelete: "restrict" }),
  // The committed migration constrains this revision to the same object.
  previousRevisionId: uuid("previous_revision_id"),
  snapshot: jsonb("snapshot").$type<ObjectSnapshot>().notNull(),
  changeType: changeTypeEnum("change_type").notNull(),
  createdByType: createdByTypeEnum("created_by_type").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  aiOperationId: uuid("ai_operation_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("object_revisions_object_id_id_uidx").on(table.objectId, table.id),
  index("object_revisions_object_created_idx").on(table.objectId, table.createdAt)
]);

export const objectRelationships = pgTable("object_relationships", {
  id: uuid("id").primaryKey().defaultRandom(), ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  sourceObjectId: uuid("source_object_id").notNull().references(() => objects.id, { onDelete: "restrict" }), targetObjectId: uuid("target_object_id").notNull().references(() => objects.id, { onDelete: "restrict" }),
  relationshipType: relationshipTypeEnum("relationship_type").$type<RelationshipType>().notNull(), label: text("label"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(), deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" })
}, (table) => [index("object_relationships_source_idx").on(table.sourceObjectId, table.createdAt), index("object_relationships_target_idx").on(table.targetObjectId, table.createdAt), uniqueIndex("object_relationships_active_uidx").on(table.sourceObjectId, table.targetObjectId, table.relationshipType).where(sql`${table.deletedAt} IS NULL`)]);

export const permissionGrants = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  resourceType: resourceTypeEnum("resource_type").$type<ResourceType>().notNull(),
  resourceId: uuid("resource_id").notNull(),
  principalType: principalTypeEnum("principal_type").$type<PrincipalType>().notNull(),
  principalId: text("principal_id"),
  capability: capabilityEnum("capability").$type<Capability>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" })
}, (table) => [
  index("permissions_resource_active_idx").on(table.resourceType, table.resourceId, table.revokedAt),
  uniqueIndex("permissions_active_grant_uidx")
    .on(table.resourceType, table.resourceId, table.principalType, sql`coalesce(${table.principalId}, '')`, table.capability)
    .where(sql`${table.revokedAt} IS NULL`)
]);

export const aiOperations = pgTable("ai_operations", {
  id: uuid("id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  operationType: text("operation_type").notNull(), instruction: text("instruction"), targetObjectId: uuid("target_object_id").notNull().references(() => objects.id, { onDelete: "restrict" }),
  targetRevisionId: uuid("target_revision_id").notNull().references(() => objectRevisions.id, { onDelete: "restrict" }),
  permittedContextIds: jsonb("permitted_context_ids").$type<string[]>().notNull(), retrievedContextManifest: jsonb("retrieved_context_manifest").$type<AIContextManifest>().notNull(),
  provider: text("provider").notNull(), model: text("model").notNull(), promptVersion: text("prompt_version").notNull(),
  structuredOutput: jsonb("structured_output").$type<AIPatchProposal>().notNull(), validationStatus: aiValidationStatusEnum("validation_status").notNull(),
  userDecision: aiUserDecisionEnum("user_decision").notNull().default("PENDING"), acceptedPatch: jsonb("accepted_patch").$type<AIPatchProposal | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" })
}, (table) => [index("ai_operations_user_created_idx").on(table.userId, table.createdAt), index("ai_operations_target_created_idx").on(table.targetObjectId, table.createdAt)]);

export const embeddingChunks=pgTable("embedding_chunks",{
  id:uuid("id").primaryKey().defaultRandom(),ownerId:uuid("owner_id").notNull().references(()=>users.id,{onDelete:"restrict"}),objectId:uuid("object_id").notNull().references(()=>objects.id,{onDelete:"restrict"}),sourceRevisionId:uuid("source_revision_id").notNull().references(()=>objectRevisions.id,{onDelete:"restrict"}),chunkIndex:integer("chunk_index").notNull(),content:text("content").notNull(),contentHash:text("content_hash").notNull(),embedding:vector("embedding",{dimensions:1536}).notNull(),metadata:jsonb("metadata").$type<{field:string;blockIds:string[]}>().notNull(),createdAt:timestamp("created_at",{withTimezone:true,mode:"date"}).notNull().defaultNow(),deletedAt:timestamp("deleted_at",{withTimezone:true,mode:"date"})
},table=>[uniqueIndex("embedding_chunks_revision_index_uidx").on(table.objectId,table.sourceRevisionId,table.chunkIndex),index("embedding_chunks_active_object_idx").on(table.objectId,table.sourceRevisionId)]);

/**
 * A file always belongs to exactly one canonical object, so file authorization is the owning
 * object's authorization. `storage_key` is server-derived and owner-prefixed; the committed
 * migration additionally enforces that prefix in the database.
 */
export const files = pgTable("files", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  objectId: uuid("object_id").notNull().references(() => objects.id, { onDelete: "restrict" }),
  storageKey: text("storage_key").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  category: fileCategoryEnum("category").$type<FileCategory>().notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  checksum: text("checksum"),
  uploadStatus: fileUploadStatusEnum("upload_status").notNull().default("PENDING"),
  scanStatus: fileScanStatusEnum("scan_status").notNull().default("PENDING"),
  processingStatus: fileProcessingStatusEnum("processing_status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" })
}, (table) => [
  uniqueIndex("files_storage_key_uidx").on(table.storageKey),
  index("files_object_created_idx").on(table.objectId, table.createdAt),
  index("files_owner_created_idx").on(table.ownerId, table.createdAt),
  uniqueIndex("files_object_checksum_uidx").on(table.objectId, table.checksum).where(sql`${table.deletedAt} IS NULL AND ${table.checksum} IS NOT NULL`)
]);

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  provider: importProviderEnum("provider").$type<ImportProviderName>().notNull(),
  status: importStatusEnum("status").$type<ImportStatus>().notNull().default("PENDING"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  importedCount: integer("imported_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  cursorState: jsonb("cursor_state").$type<{ cursor: string | null }>(),
  errorSummary: jsonb("error_summary").$type<{ errors: Array<{ sourceExternalId: string; message: string }> }>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [
  index("imports_user_created_idx").on(table.userId, table.createdAt),
  uniqueIndex("imports_active_provider_uidx").on(table.userId, table.provider).where(sql`${table.status} IN ('PENDING','RUNNING')`)
]);

export const entityMergeCandidates = pgTable("entity_merge_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  leftObjectId: uuid("left_object_id").notNull().references(() => objects.id, { onDelete: "restrict" }),
  rightObjectId: uuid("right_object_id").notNull().references(() => objects.id, { onDelete: "restrict" }),
  score: numeric("score", { precision: 4, scale: 3, mode: "number" }).notNull(),
  confidence: entityMatchConfidenceEnum("confidence").$type<MatchConfidence>().notNull(),
  signals: jsonb("signals").$type<MatchSignal[]>().notNull(),
  status: entityMergeStatusEnum("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" })
}, (table) => [
  uniqueIndex("entity_merge_candidates_pair_uidx").on(table.ownerId, table.leftObjectId, table.rightObjectId),
  index("entity_merge_candidates_owner_status_idx").on(table.ownerId, table.status, table.score)
]);

export const entityMerges = pgTable("entity_merges", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  candidateId: uuid("candidate_id").notNull().references(() => entityMergeCandidates.id, { onDelete: "restrict" }),
  targetObjectId: uuid("target_object_id").notNull().references(() => objects.id, { onDelete: "restrict" }),
  sourceObjectId: uuid("source_object_id").notNull().references(() => objects.id, { onDelete: "restrict" }),
  targetRevisionBefore: uuid("target_revision_before").notNull().references(() => objectRevisions.id, { onDelete: "restrict" }),
  targetRevisionAfter: uuid("target_revision_after").notNull().references(() => objectRevisions.id, { onDelete: "restrict" }),
  sourceRevisionBefore: uuid("source_revision_before").notNull().references(() => objectRevisions.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entity_merges_candidate_uidx").on(table.candidateId),
  index("entity_merges_owner_created_idx").on(table.ownerId, table.createdAt)
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  actorType: actorTypeEnum("actor_type").notNull(),
  action: text("action").notNull(),
  resourceType: resourceTypeEnum("resource_type").$type<ResourceType>(),
  resourceId: uuid("resource_id"),
  requestId: text("request_id"),
  metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [
  index("audit_logs_resource_created_idx").on(table.resourceType, table.resourceId, table.createdAt),
  index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt)
]);

export type UserRow = typeof users.$inferSelect;
export type ObjectRow = typeof objects.$inferSelect;
export type ObjectRevisionRow = typeof objectRevisions.$inferSelect;
export type PermissionGrantRow = typeof permissionGrants.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type ObjectRelationshipRow = typeof objectRelationships.$inferSelect;
export type AIOperationRow = typeof aiOperations.$inferSelect;
export type EmbeddingChunkRow = typeof embeddingChunks.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type ImportRow = typeof imports.$inferSelect;
export type EntityMergeCandidateRow = typeof entityMergeCandidates.$inferSelect;
export type EntityMergeRow = typeof entityMerges.$inferSelect;
