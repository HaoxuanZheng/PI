# 0026 Account Purge Execution

## Decision

Execute a deletion request in the application after its recovery window,
rather than adding a background worker the architecture deliberately
postpones (`0016`).

## Rules

- `POST /account/purge` requires `DELETION_PENDING` plus `purge_after <= now`.
  Requests inside the window fail with `DELETION_STATE_CONFLICT`, so grace
  is never executed early. The route explicitly allows the pending state
  because provisioning disables everything else.
- Objects go through the standard `softDelete` path one by one (paged, since
  `list` caps at 100), so each gains a `DELETE` revision, tombstones its
  edges, and fires the embedding, file, and publication triggers. A
  `RevisionConflict` retries once against a fresh read; vanished objects are
  skipped. Every step is idempotent, so a failed purge retries safely with
  the same endpoint, but a completed purge (`deletion_purged_at` set) and
  post-purge cancellation both refuse.
- Bulk steps in one transaction: unpublish all `PUBLISHED` publications,
  revoke all active issued grants, fail all live imports, hard-delete owned
  embedding vectors, and hard-delete owned analytics events. Stored file
  bytes go through `purgeDeleted` in bounded batches until none remain.
- Canonical rows are never hard-deleted: revisions, merges, imports history,
  grants (revoked, not removed), and audit stay. Owners keep `READ` on their
  own deleted objects, so purged history remains auditable to nobody else.
- Provider tokens need no revocation step: importers run on
  operator-supplied environment tokens, never per-user stored credentials.
- The run audits `ACCOUNT_PURGED` with counts only, and the user row keeps
  `DELETION_PENDING` with `deletion_purged_at` set, satisfying the existing
  deletion-window CHECK unchanged.

## Verification

`account-repository.integration.test.ts` (fast-forwarded window) plus
`pnpm verify:alpha-deletion`, `pnpm db:check`, `pnpm test`, `pnpm build`.
