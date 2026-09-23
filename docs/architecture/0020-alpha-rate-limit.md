# 0020 Alpha Rate Limiting

## Decision

Enforce per-route fixed-window rate limits centrally in `apps/web/lib/api.ts`
instead of scattering checks across every route handler.

## Rules

- Budgets live in exactly one table: `rateLimitRules` in
  `packages/ratelimit/src/index.ts`. Route mapping lives in `bucketForPath`
  so wiring cannot drift from the table.
- `requireApiContext` checks twice: once by client IP before auth (bounds
  anonymous abuse and session-lookup cost), once by user id after auth
  (one user cannot exhaust another user's budget).
- Failures are structured: `RATE_LIMITED` with HTTP 429, `retry-after` and
  `x-ratelimit-limit` headers, and the spec error shape with `requestId`.
- The limiter is process memory only. It bounds accidental loops and
  single-client abuse on one instance; horizontal scaling needs a shared
  store before numbers are global. This limitation is explicit in code.
- `EXPORT` (3/hour) and `ACCOUNT` (10/hour) are the tightest budgets
  because account export assembles a large slice of the database.
- Tests never share budgets: the web singleton is resettable and package
  tests inject their own clock.

## Non-goals

- No distributed limiter (Redis/DB) yet.
- No per-user custom quotas.
- No success-path `X-RateLimit-Remaining` headers yet; only 429 carries
  limit metadata in V0.15.

## Verification

`pnpm verify:alpha-ratelimit`, `pnpm test`, `pnpm build`.
