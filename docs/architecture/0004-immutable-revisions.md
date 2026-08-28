# ADR 0004: Immutable authoritative revisions

- Status: Accepted
- Date: 2026-08-28

## Context

Manual and AI-assisted edits must be explainable, reversible, and safe under concurrent updates.

## Decision

Every important object change appends an immutable snapshot revision. An object points to its current revision. Restore appends a new revision containing the restored state. Updates require the expected current revision and reject stale writes.

## Consequences

History, comparison, undo, audit, and optimistic concurrency share one model. Storage grows over time and will need retention/export policies without mutating authoritative history.
