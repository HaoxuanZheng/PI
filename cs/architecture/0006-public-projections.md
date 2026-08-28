# ADR 0006: Public identity uses authorized projections

- Status: Accepted
- Date: 2026-08-28

## Context

Public, professional, portfolio, and QR views will reuse selected Personal Graph facts. Copying those facts into independent profile tables would drift; sending private payloads to the browser would create disclosure risk.

## Decision

Publications reference canonical objects and explicit field-level selections. Server-side projection queries return only authorized public fields. Publishing, widening visibility, and unpublishing are explicit audited user actions. Public caches are invalidated on source or authorization changes.

## Consequences

Many views stay consistent with one source of truth. Projection code becomes a security boundary and requires negative privacy tests.
