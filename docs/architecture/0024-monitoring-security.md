# 0024 Monitoring and Security Hardening

## Decision

Close Alpha hardening with transport headers, structured failure logging,
and an observable health endpoint — plus MFA as an operational control in
managed auth rather than application code.

## Rules

- `next.config.ts` sends `nosniff`, `DENY` framing, strict referrer,
  a minimal `Permissions-Policy`, and a CSP of `self` plus inline scripts
  and styles (Next.js), `data:`/`blob:` images, and `*.supabase.co`
  connections. `poweredByHeader` stays disabled.
- Every API failure logs exactly one JSON line with `code`, `status`, and
  `requestId` — `error` at 5xx, `warn` below. Bodies, snapshots, note text,
  and user ids never enter general logs; security-sensitive actions keep
  their own metadata-only audit events in the database.
- `/api/health` reports per-key presence (`databaseUrl`, `supabaseUrl`,
  `supabaseAnonKey`) without values, so operators can tell which secret is
  missing without the endpoint exposing any secret. It stays rate-limited
  and never touches the database.
- Admin MFA is enforced in the Supabase dashboard (staging and production),
  documented in `docs/runbooks/staging-deployment.md`. The application never
  sees TOTP secrets, matching the managed-auth decision in the threat model.

## Non-goals

- No external error-tracking DSN wired yet (`SENTRY_DSN` is reserved in the
  runbook). JSON lines on the platform log stream are sufficient for 20
  alpha users.
- No request logging for successes; only failures are logged.
- No MFA enrollment UI; managed auth owns the flow.

## Verification

`pnpm verify:alpha-monitoring`, `pnpm test`, `pnpm build`.
