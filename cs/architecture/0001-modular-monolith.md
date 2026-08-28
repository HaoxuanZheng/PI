# ADR 0001: TypeScript modular monolith

- Status: Accepted
- Date: 2026-08-28

## Context

The MVP spans web UI, synchronous APIs, background work, authorization, graph operations, search, imports, and AI. A solo-founder team needs clear boundaries without distributed-system overhead.

## Decision

Use a pnpm TypeScript monorepo. `apps/web` owns the Next.js application and synchronous APIs. Domain capabilities live in packages with explicit public interfaces. Add one worker application only when the first background job is implemented. Do not split deployable services until measured operational or scaling needs justify it.

## Consequences

Boundaries remain testable and extractable, while local development, transactions, deployment, and observability stay simple. Package coupling must be reviewed to prevent the monolith from becoming unstructured.
