import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/db/migrations/0017_oauth_states.sql",
  "packages/db/src/repositories/oauth.ts",
  "packages/db/tests/oauth-repository.integration.test.ts",
  "apps/web/app/api/v1/connections/google/start/route.ts",
  "apps/web/app/api/v1/connections/google/callback/route.ts",
  "docs/architecture/0030-google-oauth.md"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const migration = await readFile(resolve(root, "packages/db/migrations/0017_oauth_states.sql"), "utf8");
for (const invariant of ["oauth_states", "FORCE ROW LEVEL SECURITY"]) {
  if (!migration.includes(invariant)) throw new Error(`OAuth migration missing ${invariant}`);
}

const vault = await readFile(resolve(root, "packages/connections/src/index.ts"), "utf8");
for (const invariant of ["googleAuthUrl", "exchangeGoogleCode", "refreshGoogleToken", "offline", "drive.readonly"]) {
  if (!vault.includes(invariant)) throw new Error(`OAuth protocol missing ${invariant}`);
}

const repo = await readFile(resolve(root, "packages/db/src/repositories/oauth.ts"), "utf8");
for (const invariant of ["createOAuthStateRepository", "consume", "single-use"]) {
  if (!repo.includes(invariant)) throw new Error(`OAuth state repository missing ${invariant}`);
}

const callback = await readFile(resolve(root, "apps/web/app/api/v1/connections/google/callback/route.ts"), "utf8");
for (const invariant of ["consume", "exchangeGoogleCode", "isGoogleProvider", "?error="]) {
  if (!callback.includes(invariant)) throw new Error(`OAuth callback missing ${invariant}`);
}
for (const forbidden of ["searchParams.set(\"access_token\"", "searchParams.set(\"refresh_token\""]) {
  if (callback.includes(forbidden)) throw new Error("Callback must never place tokens in redirect URLs");
}

console.log(`Google OAuth verified (${required.length} required files).`);
