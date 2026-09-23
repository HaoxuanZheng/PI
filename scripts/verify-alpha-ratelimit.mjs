import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/ratelimit/src/index.ts",
  "packages/ratelimit/tests/ratelimit.test.ts",
  "apps/web/lib/ratelimit.ts",
  "apps/web/lib/api.ts",
  "apps/web/app/api/health/route.ts",
  "docs/architecture/0020-alpha-rate-limit.md"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const limiter = await readFile(resolve(root, "packages/ratelimit/src/index.ts"), "utf8");
for (const invariant of ["rateLimitRules", "createRateLimiter", "bucketForPath", "EXPORT", "fail closed"]) {
  if (!limiter.includes(invariant)) throw new Error(`Rate limiter missing ${invariant}`);
}

const api = await readFile(resolve(root, "apps/web/lib/api.ts"), "utf8");
for (const invariant of ["RateLimitedError", "checkRateLimit", "RATE_LIMITED", "429", "retry-after"]) {
  if (!api.includes(invariant)) throw new Error(`API rate-limit wiring missing ${invariant}`);
}
if (!api.includes("requireApiContext")) throw new Error("API must enforce limits inside requireApiContext");

const webLimiter = await readFile(resolve(root, "apps/web/lib/ratelimit.ts"), "utf8");
if (!webLimiter.includes("globalThis")) throw new Error("Web limiter must reuse a process singleton across hot reloads");

const health = await readFile(resolve(root, "apps/web/app/api/health/route.ts"), "utf8");
if (!health.includes("checkRateLimit")) throw new Error("Public health endpoint must be rate-limited");

const tests = await readFile(resolve(root, "packages/ratelimit/tests/ratelimit.test.ts"), "utf8");
for (const invariant of ["retryAfterSeconds", "bucketForPath", "maxKeys"]) {
  if (!tests.includes(invariant)) throw new Error(`Rate-limit tests missing ${invariant}`);
}

console.log(`Alpha rate limiting verified (${required.length} required files).`);
