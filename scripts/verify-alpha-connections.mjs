import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/connections/src/index.ts",
  "packages/connections/tests/connections.test.ts",
  "packages/db/migrations/0016_provider_connections.sql",
  "packages/db/src/repositories/connections.ts",
  "packages/db/tests/connection-repository.integration.test.ts",
  "apps/web/app/api/v1/connections/route.ts",
  "apps/web/app/api/v1/connections/[provider]/route.ts",
  "docs/architecture/0029-provider-connections.md"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const vault = await readFile(resolve(root, "packages/connections/src/index.ts"), "utf8");
for (const invariant of ["sealToken", "openToken", "aes-256-gcm", "parseTokenKey", "connectInputSchema"]) {
  if (!vault.includes(invariant)) throw new Error(`Connection vault missing ${invariant}`);
}

const migration = await readFile(resolve(root, "packages/db/migrations/0016_provider_connections.sql"), "utf8");
for (const invariant of ["provider_connections", "provider_connections_user_provider_uidx", "FORCE ROW LEVEL SECURITY"]) {
  if (!migration.includes(invariant)) throw new Error(`Connection migration missing ${invariant}`);
}

const repo = await readFile(resolve(root, "packages/db/src/repositories/connections.ts"), "utf8");
for (const invariant of ["liveToken", "disconnect", "PROVIDER_CONNECTED", "PROVIDER_DISCONNECTED"]) {
  if (!repo.includes(invariant)) throw new Error(`Connection repository missing ${invariant}`);
}
const summarySection = repo.slice(repo.indexOf("function toSummary"), repo.indexOf("export function createConnectionRepository"));
for (const forbidden of ["accessToken", "sealed", "refreshToken"]) {
  if (summarySection.includes(forbidden)) throw new Error(`Connection status must never carry ${forbidden}`);
}

const status = await readFile(resolve(root, "apps/web/app/api/v1/connections/route.ts"), "utf8");
if (!status.includes("getConnectionRepository")) throw new Error("Connection routes must use the repository");

const lib = await readFile(resolve(root, "apps/web/lib/imports.ts"), "utf8");
if (!lib.includes("getImportProviderFor")) throw new Error("Importers must prefer live user connections");

console.log(`Provider connections verified (${required.length} required files).`);
