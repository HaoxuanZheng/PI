import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "AGENTS.md",
  "README.md",
  "apps/web/app/page.tsx",
  "apps/web/app/auth/page.tsx",
  "apps/web/app/auth/confirm/route.ts",
  "apps/web/app/library/page.tsx",
  "apps/web/proxy.ts",
  "packages/auth/src/index.ts",
  "packages/config/src/index.ts",
  "packages/db/src/index.ts",
  "packages/db/migrations/0000_foundation.sql",
  "docs/product/PERSONAL_INTERNET_TECHNICAL_SPEC_V0.1.md",
  "docs/architecture/0001-modular-monolith.md",
  "docs/architecture/0002-postgres-source-of-truth.md",
  "docs/architecture/0003-pgvector-semantic-retrieval.md",
  "docs/architecture/0004-immutable-revisions.md",
  "docs/architecture/0005-ai-proposal-patch.md",
  "docs/architecture/0006-public-projections.md",
  ".github/workflows/ci.yml"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const migration = await readFile(resolve(root, "packages/db/migrations/0000_foundation.sql"), "utf8");
if (!migration.includes("CREATE EXTENSION IF NOT EXISTS vector")) {
  throw new Error("Foundation migration must enable pgvector idempotently");
}

const agents = await readFile(resolve(root, "AGENTS.md"), "utf8");
for (const invariant of ["AI may propose changes", "private by default", "immutable revision"]) {
  if (!agents.toLowerCase().includes(invariant.toLowerCase())) {
    throw new Error(`AGENTS.md is missing invariant: ${invariant}`);
  }
}

console.log(`Foundation structure verified (${required.length} required files).`);
