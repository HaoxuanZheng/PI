import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "apps/web/app/library/[objectId]/ObjectEditor.tsx",
  "apps/web/app/library/[objectId]/RestoreRevisionButton.tsx",
  "apps/web/app/library/[objectId]/compare/page.tsx",
  "docs/architecture/0009-editor-autosave.md",
  "docs/runbooks/editor.md"
];
await Promise.all(required.map((path) => access(resolve(root, path))));

const editor = await readFile(resolve(root, required[0]), "utf8");
for (const invariant of ["expectedRevisionId", "REVISION_CONFLICT", "localStorage", "900", "canEdit"]) {
  if (!editor.includes(invariant)) throw new Error(`Editor is missing: ${invariant}`);
}
const repository = await readFile(resolve(root, "packages/db/src/repositories/objects.ts"), "utf8");
if (!repository.includes("sameValue") || !repository.includes('action: "EDIT"')) {
  throw new Error("Editor saves must be authorized and suppress identical revisions");
}
const restore = await readFile(resolve(root, required[1]), "utf8");
if (!restore.includes("showModal") || !restore.includes("Create restored revision")) {
  throw new Error("Restore requires an explicit confirmation dialog");
}
console.log(`Editor verified (${required.length} required files).`);
