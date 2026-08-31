# 0016 — Idempotent import framework

Status: accepted (V0.11)

## Context

The MVP requires three importers in priority order — Google Drive, Notion, Google Contacts
(technical specification §4.1, §22–§26). The acceptance bar is explicit: importing the same unchanged
source twice must create zero duplicate authoritative objects, a failed import must resume, and
imported content must be private.

Imports are the first subsystem where LifeGraph writes authoritative objects from data it did not
author. That creates two risks the manual path does not have: duplicate objects on every re-sync, and
provider data leaking into public projections.

## Decision

**Provenance lives on the object, not in a side table.** `objects` gains `source_content_hash` and
`source_modified_at` alongside the existing `source_type` and `source_external_id`. A partial unique
index on `(owner_id, source_type, source_external_id) WHERE deleted_at IS NULL` makes a duplicate
import of one external record unrepresentable rather than merely avoided.

**Idempotency is a content hash, and the decision is pure.** `hashImportContent` hashes canonicalised
JSON, so key order cannot change a digest. `decideImportAction` maps `(existing, incoming)` to
`CREATE`, `UPDATE`, or `SKIP` with no database access, which is what makes the rule testable offline.
An unchanged source is skipped rather than rewritten, so a repeated import creates neither duplicate
objects nor revision noise.

**Imported writes reuse the revision path.** `applyImported` lives in the object repository beside
the manual write path, so imported changes obey the same invariants: an immutable revision per
change, attributed with `createdByType = IMPORT`, and no type change between revisions. Imported
objects are always written `PRIVATE`; the importer cannot set visibility at all.

**Runs are resumable by construction.** Each batch commits its `cursor_state` before returning, so an
interrupted run resumes from the last committed page instead of restarting or skipping records. A
provider failure marks the run `FAILED` while preserving the cursor, and `resume` re-opens it. A
partial unique index on `(user_id, provider) WHERE status IN ('PENDING','RUNNING')` prevents a double
submit from fanning out concurrent duplicate work.

**One bad record does not abort a run.** Per-item failures increment `error_count` and are recorded in
`error_summary` (capped), and the batch continues. Only a provider-level failure fails the run.

**Providers only read and normalise.** The `ImportProvider` contract is `discover` plus
`fetchBatch`; adapters return normalised items and never touch the database. Raw provider metadata is
preserved under `customFields.source` for future migration debugging, and is never mapped into a
field a public projection reads.

## Consequences

- Batches are driven by explicit requests in V0.11 rather than a background worker. A large import
  requires repeated `continue` calls. This keeps the milestone free of a job-runner dependency, but
  it is not the final shape.
- The Google Drive adapter accepts an already-obtained read-only access token. The OAuth consent
  flow and refresh-token storage are deliberately out of scope, which means the importer is not yet
  usable by a real end user without operator-supplied credentials.
- PDFs import as metadata-only records; text extraction belongs to the file processing pipeline.
  Drive imports do not yet create `files` rows, so imported binaries have no stored bytes.
- Entity resolution is not implemented. Google Contacts will need deterministic match signals
  (§21) before it can land, and person dedupe is therefore still open.
- `hashImportContent` covers mapped content, not the provider's own change token. A provider edit
  that does not alter mapped fields is correctly treated as unchanged.
