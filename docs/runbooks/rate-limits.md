# Rate Limiting V0.15

Budgets live in exactly one table, `rateLimitRules` in `packages/ratelimit/src/index.ts`, and `bucketForPath` maps request paths to buckets so wiring cannot drift. `requireApiContext` checks twice per request: by client IP before authentication (anonymous abuse never reaches session lookup) and by user id after (one user cannot exhaust another's budget).

Tight budgets: `EXPORT` 3/hour, `ACCOUNT` 10/hour, `AI` 20/minute, `PUBLISH` 20/minute. Failures return `RATE_LIMITED` with HTTP 429 plus `retry-after` and `x-ratelimit-limit` headers. A client hitting 429 must back off until `retry-after` seconds elapse rather than retrying immediately.

The limiter is process memory only and bounds single-instance abuse; a horizontally scaled deployment needs a shared store before numbers are global. Never log keys, IPs, or user ids alongside limit decisions.
