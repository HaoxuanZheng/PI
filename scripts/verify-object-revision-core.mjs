import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/domain/src/index.ts",
  "packages/db/src/schema.ts",
  "packages/db/src/repositories/objects.ts",
  "packages/db/migrations/0001_object_revision_core.sql",
  "apps/web/app/api/v1/objects/route.ts",
  "apps/web/app/api/v1/objects/[objectId]/route.ts",
  "apps/web/app/api/v1/objects/[objectId]/revisions/route.ts",
  "apps/web/app/api/v1/objects/[objectId]/restore/route.ts",
  "packages/db/tests/object-repository.integration.test.ts"
];

await Promise.all(required.map((path) => access(resolve(root, path))));
const migration = await readFile(resolve(root, required[3]), "utf8");
for (const invariant of [
  "object_revisions_immutable_update",
  "object_revisions_immutable_delete",
  "objects_current_revision_owner_fk",
  "ENABLE ROW LEVEL SECURITY",
  "FORCE ROW LEVEL SECURITY"
]) {
  if (!migration.includes(invariant)) throw new Error(`Core migration is missing: ${invariant}`);
}

const repository = await readFile(resolve(root, required[2]), "utf8");
if (!repository.includes('.for("update")') || !repository.includes("RevisionConflictError")) {
  throw new Error("Repository must lock rows and enforce optimistic concurrency");
}

console.log(`Object + Revision Core verified (${required.length} required files).`);
