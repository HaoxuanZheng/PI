# ADR 0002: PostgreSQL is the source of truth

- Status: Accepted
- Date: 2026-08-28

## Context

LifeGraph needs transactions across objects, revisions, edges, permissions, publications, and audit records. Those records must remain portable and queryable.

## Decision

Use managed-PostgreSQL-compatible SQL as the authoritative datastore, Drizzle ORM for typed access, and committed explicit migrations. Application authorization is mandatory; row-level security and storage policies add defense in depth. Derived indexes never become authoritative.

## Consequences

Core writes can be transactional and exportable. Schema evolution requires reviewed migrations, rollback notes, and compatibility awareness.
