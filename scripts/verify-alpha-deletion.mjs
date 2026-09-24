import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/db/migrations/0012_deletion_pipeline.sql",
  "packages/db/migrations/0014_account_purge.sql",
  "packages/db/src/schema.ts",
  "packages/db/src/repositories/objects.ts",
  "packages/db/src/repositories/accounts.ts",
  "packages/db/tests/account-repository.integration.test.ts",
  "packages/privacy/tests/deletion.test.ts",
  "apps/web/app/api/v1/account/delete/route.ts",
  "apps/web/app/api/v1/account/purge/route.ts",
  "apps/web/lib/actor.ts",
  "apps/web/lib/api.ts",
  "docs/architecture/0021-deletion-pipeline.md",
  "docs/architecture/0026-account-purge.md"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const migration = await readFile(resolve(root, "packages/db/migrations/0012_deletion_pipeline.sql"), "utf8");
for (const invariant of [
  "deletion_requested_at",
  "deletion_purge_after",
  "users_deletion_window",
  "tombstone_deleted_object_edges",
  "objects_tombstone_edges_on_delete",
  "object_relationships"
]) {
  if (!migration.includes(invariant)) throw new Error(`Deletion migration missing ${invariant}`);
}

const objects = await readFile(resolve(root, "packages/db/src/repositories/objects.ts"), "utf8");
for (const invariant of ["objectRelationships", "sourceObjectId", "targetObjectId", "OBJECT_SOFT_DELETED"]) {
  if (!objects.includes(invariant)) throw new Error(`Object softDelete missing ${invariant}`);
}

const accounts = await readFile(resolve(root, "packages/db/src/repositories/accounts.ts"), "utf8");
for (const invariant of [
  "requestDeletion",
  "cancelDeletion",
  "purgeAccount",
  "DELETION_PENDING",
  "ACCOUNT_DELETION_REQUESTED",
  "ACCOUNT_DELETION_CANCELLED",
  "ACCOUNT_PURGED",
  "deletionPurgedAt",
  "purgeAfter"
]) {
  if (!accounts.includes(invariant)) throw new Error(`Account repository missing ${invariant}`);
}
if (accounts.includes("ON DELETE CASCADE")) {
  throw new Error("Purge must never hard-delete canonical rows");
}

const purgeMigration = await readFile(resolve(root, "packages/db/migrations/0014_account_purge.sql"), "utf8");
if (!purgeMigration.includes("deletion_purged_at")) throw new Error("Purge migration missing deletion_purged_at");

const purgeRoute = await readFile(resolve(root, "apps/web/app/api/v1/account/purge/route.ts"), "utf8");
for (const invariant of ["purgeAccount", "allowDeletionPending"]) {
  if (!purgeRoute.includes(invariant)) throw new Error(`Account purge route missing ${invariant}`);
}

const route = await readFile(resolve(root, "apps/web/app/api/v1/account/delete/route.ts"), "utf8");
for (const invariant of ["requestDeletionInputSchema", "allowDeletionPending", "cancelDeletion"]) {
  if (!route.includes(invariant)) throw new Error(`Account delete route missing ${invariant}`);
}

const actor = await readFile(resolve(root, "apps/web/lib/actor.ts"), "utf8");
if (!actor.includes("provisionActorAllowingPendingDeletion")) {
  throw new Error("Actor must expose a pending-deletion-tolerant provision path for the recovery window");
}

console.log(`Deletion pipeline verified (${required.length} required files).`);
