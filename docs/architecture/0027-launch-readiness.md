# 0027 Launch Readiness

## Decision

Separate liveness from readiness and write down everything humans must do
before widening access, rather than carrying launch criteria in chat history.

## Rules

- `/api/health` stays liveness: no secrets, no database, always cheap. It
  answers whether the process runs, nothing more.
- `/api/ready` is readiness: presence booleans plus one trivial query, 503
  on any failure without leaking driver detail, rate-limited like every
  other route. Load balancers and container probes point here; pointing them
  at `/api/health` would route traffic into a database outage.
- `docs/runbooks/launch-checklist.md` is the alpha exit gate: legal review,
  MFA, secrets rotation, least-privilege role, backup retention with a
  rehearsed restore, green integration suite, traffic probing, and the
  security re-verification list. Accepted gaps (idempotency keys, external
  analytics pipeline, error-tracking DSN) are recorded as decisions.
- Backup policy lives in the staging runbook: retention window documented,
  restore rehearsed, and account-deletion responses state the window
  honestly since backups outlive purges by design.

## Verification

`pnpm verify:alpha-monitoring`, `pnpm test`, `pnpm build`.
