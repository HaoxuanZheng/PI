# 0028 Idempotency Keys

## Decision

Support opt-in `Idempotency-Key` headers on retried POSTs, starting with
object creation, instead of letting timeouts and double-submits silently
duplicate work.

## Rules

- Keys are client-generated, 1-64 URL-safe characters, scoped per user with
  a 24-hour TTL. Unknown users, malformed keys, and expired rows fail safe:
  validation errors, treated-as-absent, never silent reuse.
- The protocol is find, reserve, execute, complete. Reserving first turns a
  concurrent duplicate into a unique-index violation mapped to
  `IDEMPOTENCY_CONFLICT` (HTTP 409 with `retry-after: 1`) instead of a
  second execution. Completed responses replay byte-identically with the
  current request id plus an `x-idempotent-replay` marker.
- Only successes are stored. Handler errors drop the reservation so the
  retry proceeds; nothing half-written is ever replayed.
- Responses stay small on wired routes. Large-response routes (account
  export) are deliberately not wired: caching multi-megabyte bundles in
  jsonb would trade a duplicate risk for a storage problem. Natural
  idempotency already covers imports (one live run per provider) and purge
  (completion marker refuses repeats).
- Keys never leave the owning user: the table is owner-isolated by RLS like
  every other user table, and the same key works independently per user.

## Verification

`idempotency-repository.integration.test.ts`,
`pnpm verify:alpha-idempotency`, `pnpm test`, `pnpm build`.
