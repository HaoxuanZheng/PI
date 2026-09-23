import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "apps/web/next.config.ts",
  "apps/web/lib/api.ts",
  "apps/web/app/api/health/route.ts",
  "docs/architecture/0024-monitoring-security.md",
  "docs/runbooks/staging-deployment.md"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const config = await readFile(resolve(root, "apps/web/next.config.ts"), "utf8");
for (const invariant of [
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "poweredByHeader"
]) {
  if (!config.includes(invariant)) throw new Error(`Security headers missing ${invariant}`);
}
if (config.includes("frame-ancestors") === false) throw new Error("CSP must deny framing");

const api = await readFile(resolve(root, "apps/web/lib/api.ts"), "utf8");
for (const invariant of ["logApiError", "requestId", "console.error", "console.warn"]) {
  if (!api.includes(invariant)) throw new Error(`Structured logging missing ${invariant}`);
}
if (/console\.(error|warn|log)\([^)]*(input|body|snapshot|password)/i.test(api)) {
  throw new Error("Application logs must not include bodies, snapshots, or credentials");
}

const health = await readFile(resolve(root, "apps/web/app/api/health/route.ts"), "utf8");
for (const invariant of ["checks", "databaseUrl", "supabaseUrl", "supabaseAnonKey"]) {
  if (!health.includes(invariant)) throw new Error(`Health endpoint missing ${invariant}`);
}
if (/process\.env\.\w+\s*[^&|]*\}/.test(health) && health.includes("DATABASE_URL}")) {
  throw new Error("Health must report presence booleans, never secret values");
}

const runbook = await readFile(resolve(root, "docs/runbooks/staging-deployment.md"), "utf8");
if (!runbook.includes("Admin MFA")) throw new Error("Runbook must document admin MFA enforcement");

console.log(`Monitoring and security hardening verified (${required.length} required files).`);
