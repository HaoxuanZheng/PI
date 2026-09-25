import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/db/migrations/0015_idempotency_keys.sql",
  "packages/db/src/repositories/idempotency.ts",
  "packages/db/tests/idempotency-repository.integration.test.ts",
  "apps/web/lib/idempotency.ts",
  "apps/web/app/api/v1/objects/route.ts",
  "docs/architecture/0028-idempotency-keys.md"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const migration = await readFile(resolve(root, "packages/db/migrations/0015_idempotency_keys.sql"), "utf8");
for (const invariant of [
  "idempotency_keys",
  "idempotency_keys_user_key_uidx",
  "idempotency_keys_expires_idx",
  "FORCE ROW LEVEL SECURITY"
]) {
  if (!migration.includes(invariant)) throw new Error(`Idempotency migration missing ${invariant}`);
}

const repo = await readFile(resolve(root, "packages/db/src/repositories/idempotency.ts"), "utf8");
for (const invariant of [
  "parseIdempotencyKey",
  "IdempotencyInFlightError",
  "idempotencyTtlHours",
  "23505"
]) {
  if (!repo.includes(invariant)) throw new Error(`Idempotency repository missing ${invariant}`);
}

const helper = await readFile(resolve(root, "apps/web/lib/idempotency.ts"), "utf8");
for (const invariant of ["withIdempotency", "x-idempotent-replay", "discard"]) {
  if (!helper.includes(invariant)) throw new Error(`Idempotency helper missing ${invariant}`);
}

const route = await readFile(resolve(root, "apps/web/app/api/v1/objects/route.ts"), "utf8");
if (!route.includes("withIdempotency")) throw new Error("Object creation must run through withIdempotency");

const api = await readFile(resolve(root, "apps/web/lib/api.ts"), "utf8");
if (!api.includes("IDEMPOTENCY_CONFLICT")) throw new Error("API must map the in-flight conflict to 409");

console.log(`Idempotency keys verified (${required.length} required files).`);
