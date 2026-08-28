# ADR 0005: AI proposal and patch boundary

- Status: Accepted
- Date: 2026-08-28

## Context

LLM output is probabilistic and may be malformed, unauthorized, stale, or affected by prompt injection. It cannot be an authority over private user data.

## Decision

AI providers return versioned, schema-constrained proposals. Deterministic code validates schema, authorization, allowed paths, business rules, and base revision. The UI displays a diff and requires Accept, Reject, or Edit. Acceptance performs one transaction and appends a revision; AI providers never receive database write access.

## Consequences

AI interactions remain reviewable and reversible. The product accepts additional UI friction in exchange for user control and data integrity.
