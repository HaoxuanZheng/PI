import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/db/src/repositories/exports.ts",
  "apps/web/app/api/v1/account/export/route.ts",
  "packages/privacy/tests/deletion.test.ts",
  "docs/architecture/0022-account-export.md"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const repo = await readFile(resolve(root, "packages/db/src/repositories/exports.ts"), "utf8");
for (const invariant of [
  "exportBundle",
  "assertBundleOwnership",
  "ACCOUNT_EXPORTED",
  "objectRevisions",
  "permissionGrants",
  "auditLogs"
]) {
  if (!repo.includes(invariant)) throw new Error(`Export repository missing ${invariant}`);
}
if (repo.includes("embeddingChunks")) {
  throw new Error("Export must not bundle derived embeddings; they are reproducible from revisions");
}

const route = await readFile(resolve(root, "apps/web/app/api/v1/account/export/route.ts"), "utf8");
for (const invariant of ["requestExportInputSchema", "renderMarkdownExport", "getExportRepository"]) {
  if (!route.includes(invariant)) throw new Error(`Export route missing ${invariant}`);
}

console.log(`Account export verified (${required.length} required files).`);
