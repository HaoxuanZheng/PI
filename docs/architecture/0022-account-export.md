# 0022 Account Export

## Decision

Export assembles every user-owned collection in one transaction and checks
the bundle before returning it, rather than trusting per-table queries.

## Rules

- Collections are explicit in `exportCollections`: objects, revisions,
  relationships, files, publications, imports, aiOperations, mergeCandidates,
  merges, grantsIssued, auditEvents. Adding a table to the schema does not
  silently start or stop being exported.
- Soft-deleted rows are included: an export is a complete history, not a
  filtered view. Derived `embedding_chunks` are excluded because they are
  reproducible from revisions.
- `assertBundleOwnership` is the final guard: any record belonging to another
  user, or any revision outside the exported objects, aborts the export
  instead of shipping a mixed bundle.
- `POST /account/export` takes `{ format: JSON | MARKDOWN }`. JSON is
  authoritative with full revision history; MARKDOWN is a readable companion.
- The route sits in the `EXPORT` bucket (3/hour) because it reads a large
  slice of the database. Failures use the spec error shape with `requestId`;
  an ownership violation is a 500, never a partial bundle.
- The export itself is audited as `ACCOUNT_EXPORTED` with counts only
  (`bundleVersion`, `objectCount`, `revisionCount`). No snapshot, body, or
  file content ever enters audit metadata or logs.

## Verification

`pnpm verify:alpha-export`, `pnpm test`, `pnpm build`.
No new migration: the export reads existing tables only.
