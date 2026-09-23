# 0021 Deletion Pipeline

## Decision

Object deletion tombstones both directions of the graph in the same
transaction that marks the object, and account deletion is a requested state
with a 7-day recovery window rather than an immediate purge.

## Rules

- `softDelete` still appends an immutable `DELETE` revision and audits
  `OBJECT_SOFT_DELETED`. It now also tombstones `object_relationships`
  where the deleted object is either endpoint, so no live edge dangles.
- Migration `0012` adds a database-level trigger with the same tombstoning
  as defence in depth: embeddings (0006), files (0007), and publications
  (0011) already invalidate this way, and edges were the missing cascade.
- `users` gains `deletion_requested_at` / `deletion_purge_after` with a
  `users_deletion_window` CHECK: `DELETION_PENDING` always carries both
  dates with `purge_after >= requested_at`; `ACTIVE`/`SUSPENDED` carry
  neither. Existing rows satisfy the constraint without migration.
- `POST /account/delete` requires `{ confirm: true, acknowledgement:
  "DELETE MY ACCOUNT" }`, sets `DELETION_PENDING`, and audits
  `ACCOUNT_DELETION_REQUESTED` with the computed purge date.
- `DELETION_PENDING` fails ordinary provisioning immediately, so every
  other route is disabled. `GET`/`DELETE /account/delete` explicitly allow
  the pending state so status and cancellation stay reachable inside the
  window; cancellation restores `ACTIVE` and audits
  `ACCOUNT_DELETION_CANCELLED`.
- Purge execution (storage bytes, embeddings, backups, provider tokens) is
  explicitly not implemented in V0.16. The endpoint records the request
  honestly and reports `purgeAfter`; it never claims data is already gone.

## Verification

`pnpm verify:alpha-deletion`, `pnpm db:check`, `pnpm test`, `pnpm build`.
Database-backed integration tests remain skipped without `TEST_DATABASE_URL`,
so migration `0012` is unverified against a real PostgreSQL instance.
