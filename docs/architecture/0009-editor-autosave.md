# ADR 0009: Conflict-safe editor autosave

- Status: Accepted
- Date: 2026-08-28

## Context

The editor must survive refresh and reconnect without weakening immutable revision history. Multiple tabs or collaborators may save from the same base revision.

## Decision

The browser stores each changed full snapshot as a per-object device-local draft before a 900 ms debounced save. Saves are serialized and call the existing deterministic PATCH operation with `expectedRevisionId`. The server locks the object row, rejects stale bases with `REVISION_CONFLICT`, and treats an identical snapshot and metadata as a no-op. A conflict never triggers an automatic last-write-wins retry.

Editor content uses ordered, validated paragraph, heading, and bullet blocks. Legacy plain-text snapshots are normalized only for editing and remain readable. Revision comparison is a deterministic snapshot comparison. Restore requires explicit confirmation and appends a `RESTORE` revision.

## Consequences

Refresh and transient disconnection retain a draft on the same browser. Cross-device offline synchronization and semantic block moves are intentionally deferred. Device-local drafts contain private content and must never be placed in analytics or audit metadata.
