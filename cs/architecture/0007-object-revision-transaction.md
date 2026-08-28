# ADR 0007: Object and revision writes share one transaction

- Status: Accepted
- Date: 2026-08-28

## Context

An authoritative object points to a current immutable revision. A failed or concurrent update must never leave the pointer and history inconsistent.

## Decision

Create, update, restore, and soft-delete operations run in one PostgreSQL transaction. Updates lock the owner-scoped object row and require `expectedRevisionId` to equal `currentRevisionId`. The operation appends a revision before moving the pointer. Composite foreign keys ensure current and previous revisions belong to the same object. Database triggers reject revision updates and deletes.

## Consequences

Clients receive `REVISION_CONFLICT` rather than overwriting newer work. Restoring old content creates a new `RESTORE` revision. Hard deletion requires a future reviewed deletion pipeline because revision immutability deliberately blocks ad hoc cascades.
