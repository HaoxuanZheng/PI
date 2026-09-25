# Launch Checklist

Alpha exit gate (from the specification): 20 serious alpha users, no known
Critical/High privacy defect, deletion pipeline tested, founder observes
activation and retention. Do not launch to a wider audience with any box
unchecked.

## Humans decide

- [ ] Legal and compliance review completed for public launch. Code cannot
  discharge this; `0019` only makes publication technically possible.
- [ ] Every admin/owner account enrolled in MFA, in Supabase and in the
  dashboard organization. Accounts without MFA hold no admin access.
- [ ] 20 alpha users invited and at least activation cohorts observed via
  `analytics_events` (`onboarding_completed`, 10-object activation).

## Secrets and access

- [ ] Production `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `AI_API_KEY`, and provider tokens stored as secrets, never committed.
  Rotation process documented and at least exercised once.
- [ ] Production database role is least-privilege: no superuser, no
  `BYPASSRLS` (`0025`). The `vector` extension is installed once by a
  superuser; the app role owns the migrated schema.
- [ ] `SENTRY_DSN` decision recorded: wire error tracking or explicitly
  accept platform log streams (JSON failure lines with code, status, and
  requestId, no private content).

## Data safety

- [ ] Managed-database backups enabled with a documented retention window.
  Purge semantics: backups retain user data until retention expires, so the
  account-deletion response states the window honestly instead of promising
  instant erasure everywhere.
- [ ] At least one restore rehearsed into an isolated database, migrations
  applied cleanly, and the app booted against it (`/api/ready` 200).
- [ ] `TEST_DATABASE_URL` integration suite green in CI (21+ files, zero
  skips): every migration from `0007` onward executes for real.

## Traffic

- [ ] Load balancer probes `/api/ready` (database-backed, 503 on outage),
  not `/api/health` (liveness only). Rate-limit budgets reviewed against
  expected alpha traffic; `EXPORT` stays at 3/hour.
- [ ] No known Critical/High privacy defect open. The security test list in
  the specification (cross-user access, embedding isolation, public
  projection leakage, deleted-object search, stale AI patch, malicious
  import prompt) re-verified before widening access.

## Explicitly deferred

External analytics pipeline and error tracking DSN are accepted gaps for
alpha, recorded here so they are decisions rather than oversights.
Idempotency keys were deferred and have since shipped (`0028`); large-response
routes such as account export stay unwired by design.
