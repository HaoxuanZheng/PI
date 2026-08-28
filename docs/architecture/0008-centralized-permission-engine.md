# ADR 0008: Centralized capability authorization

- Status: Accepted
- Date: 2026-08-28

## Context

Owner checks scattered through repositories would drift as editing, graph, AI, imports, and sharing add new access paths. Public objects must also never become raw public API payloads.

## Decision

All object operations use one capability decision model: `can(actor, action, resource)`. Owners receive every capability. Explicit USER grants use a documented implication matrix; for example EDIT implies READ but not SHARE. PostgreSQL RLS independently filters rows using active direct grants. Public grants do not expose canonical OBJECT records; future anonymous access must use a PUBLICATION projection.

Only the owner may grant, list, or revoke permissions in V0.3. ADMIN controls the object's lifecycle but cannot delegate access. This conservative boundary can be widened later with a separately reviewed delegation model.

## Consequences

Future features share one authorization vocabulary and denied cross-user access does not confirm resource existence. Permission changes and sensitive object actions create metadata-only audit events. Connection, group, link, and system-AI principals remain representable but are not accepted by the current object-sharing API until their identity and lifecycle models exist.
