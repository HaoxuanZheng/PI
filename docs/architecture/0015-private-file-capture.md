# 0015 — Private file capture

Status: accepted (V0.10)

## Context

The MVP requires file, image, and voice capture (technical specification §4.1). The AI spine
(V0.2–V0.9) shipped text-only objects, so no authoritative record of stored bytes existed. Imports
(Week 9–10) cannot land before this exists, because imported Drive and Notion content is largely
files.

Object storage introduces failure modes the text path does not have: a client can propose a path, a
content type can disagree with its bytes, uploads can be abandoned half-finished, and stored bytes
outlive a deleted database row unless deletion is propagated.

## Decision

**Files inherit object authorization.** A file row always references exactly one canonical object,
and every operation resolves that object and asks `@lifegraph/permissions` about it. There is no
separate file grant table and no inline owner check. Attaching bytes requires `EDIT`; reading
metadata or a signed URL requires `READ`.

**Storage keys are server-derived and owner-prefixed.** `deriveStorageKey` produces
`{ownerId}/{fileId}/{sanitizedFilename}` from validated UUIDs. Filenames are stripped of directory
components and control characters. The client never supplies a path. The database repeats the rule as
a `CHECK` constraint (`files_storage_key_owner_prefix`), so one user's upload cannot address or
overwrite another user's bytes even if application code regresses.

**Uploads are a two-phase lifecycle.** `POST /files/upload-intent` validates the request against a
content-type allowlist with per-category size limits, reserves a `PENDING` row, and returns a
short-lived signed URL. `POST /files/:id/complete` confirms the reserved size and records a SHA-256
digest, moving the row to `STORED`. A `CHECK` constraint makes `STORED` without a digest
unrepresentable. Bytes that were never confirmed are never served.

**Downloads are gated on a scan verdict.** `scan_status` starts `PENDING`; `createDownloadUrl`
refuses anything that is not `CLEAN` while `STORAGE_REQUIRE_SCAN` is enabled, which configuration
forces on in production. Only `recordScanResult` — a worker-facing hook — may set `CLEAN`; product
code cannot.

**Deletion propagates to storage.** Deleting a file soft-deletes the row and then removes the stored
object. Soft-deleting the owning object cascades to its attachments through the
`objects_invalidate_files` trigger, mirroring embedding invalidation, and `purgeDeleted` removes the
bytes for rows the trigger marked.

**Provider code stays behind a port.** `StoragePort` exposes upload, download, and remove. The
Supabase Storage adapter holds the only provider SDK calls; an in-memory adapter makes the contract
testable offline. The service-role key is server-only and required in production.

## Consequences

- Private bytes are never proxied through the application; reads are short-lived signed URLs against
  a private bucket.
- The RLS `SELECT` policy permits an owner to read their own soft-deleted rows, because deletion
  propagation must read a storage key to remove bytes. Grantees never see deleted rows, and every
  application read path filters `deleted_at` explicitly.
- No scanner is wired yet. With `STORAGE_REQUIRE_SCAN` enabled, completed uploads are not
  downloadable until a scanner records a verdict. This is deliberate: the gate exists before the
  bytes do, rather than being retrofitted after public sharing ships.
- A storage failure after the intent transaction commits leaves an abandoned `PENDING` row. Such rows
  are never downloadable and are reclaimable by the deletion job.
- Declared content types are trusted only as far as the allowlist and the size limit. Byte-level
  sniffing and transcription belong to the processing pipeline, tracked by `processing_status`.
