import type { ObjectSnapshot } from "@lifegraph/domain";
import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const accountStatusEnum = pgEnum("account_status", ["ACTIVE", "SUSPENDED", "DELETION_PENDING"]);
export const objectTypeEnum = pgEnum("object_type", [
  "NOTE", "IDEA", "PROJECT", "PERSON", "EXPERIENCE", "SKILL", "FILE", "PHOTO",
  "VOICE_NOTE", "EVENT", "CREDENTIAL", "GENERIC"
]);
export const visibilityEnum = pgEnum("visibility", ["PRIVATE", "PUBLIC"]);
export const changeTypeEnum = pgEnum("change_type", ["CREATE", "UPDATE", "RESTORE", "DELETE"]);
export const createdByTypeEnum = pgEnum("created_by_type", ["USER", "AI_ACCEPTED", "IMPORT", "SYSTEM_MIGRATION", "RESTORE"]);

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
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" })
}, (table) => [
  index("objects_owner_updated_idx").on(table.ownerId, table.updatedAt),
  index("objects_owner_type_idx").on(table.ownerId, table.type)
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

export type UserRow = typeof users.$inferSelect;
export type ObjectRow = typeof objects.$inferSelect;
export type ObjectRevisionRow = typeof objectRevisions.$inferSelect;
