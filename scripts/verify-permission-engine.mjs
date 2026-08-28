import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/permissions/src/index.ts",
  "packages/permissions/tests/permissions.test.ts",
  "packages/db/src/repositories/permissions.ts",
  "packages/db/migrations/0002_permission_engine.sql",
  "apps/web/app/api/v1/objects/[objectId]/permissions/route.ts",
  "apps/web/app/api/v1/objects/[objectId]/permissions/[permissionId]/route.ts",
  "docs/architecture/0008-centralized-permission-engine.md"
];
await Promise.all(required.map((path) => access(resolve(root, path))));

const migration = await readFile(resolve(root, required[3]), "utf8");
for (const invariant of [
  "permissions_owner_matches_resource",
  "objects_owner_immutable",
  "permissions_select_policy",
  "audit_logs_insert_policy",
  "p.capability IN ('EDIT', 'COLLABORATE', 'ADMIN')"
]) {
  if (!migration.includes(invariant)) throw new Error(`Permission migration is missing: ${invariant}`);
}
if (migration.includes("p.principal_type = 'PUBLIC' AND p.resource_id = objects.id")) {
  throw new Error("Canonical objects must not be exposed by PUBLIC grants");
}

const repository = await readFile(resolve(root, "packages/db/src/repositories/objects.ts"), "utf8");
for (const action of ['action: "READ"', 'action: "EDIT"', 'action: "ADMIN"']) {
  if (!repository.includes(action)) throw new Error(`Object repository is missing centralized check: ${action}`);
}

console.log(`Permission Engine verified (${required.length} required files).`);
