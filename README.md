# LifeGraph

LifeGraph is a private-by-default Personal Internet: one user-owned source of truth that can power a private library, trusted AI assistance, and explicitly authorized public views.

This repository contains the **Foundation** and **Object + Revision Core** milestones. Permissions beyond owner isolation, rich editing, graph, AI, retrieval, imports, and Living Identity are intentionally not implemented yet.

## Requirements

- Node.js 20.9 or newer
- pnpm 11
- PostgreSQL 15+ (managed PostgreSQL is supported)
- A Supabase project for the current authentication adapter

## Local setup

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`. The root page is public. `/auth` provides email/password sign-up and sign-in through the configured authentication provider. `/library` can create private notes, display objects, inspect immutable revisions, and restore an older snapshot as a new revision. `/api/health` reports application readiness without exposing secrets.

## Commands

```bash
pnpm dev          # start the web application
pnpm lint         # lint all workspaces
pnpm typecheck    # type-check all workspaces
pnpm test         # run unit tests
pnpm build        # create the production web build
pnpm check        # run every required verification
pnpm db:generate  # generate SQL from future Drizzle schema changes
pnpm db:migrate   # apply committed migrations
pnpm db:check     # validate migration metadata
```

Database-backed integration tests run when `TEST_DATABASE_URL` points to a disposable PostgreSQL database. Without it, those tests are explicitly skipped rather than silently replaced with mocks.

## Repository map

- `apps/web`: Next.js App Router application and synchronous API surface
- `packages/auth`: authentication contracts and Supabase adapter
- `packages/config`: validated client/server environment boundaries
- `packages/db`: PostgreSQL connection and Drizzle migrations
- `packages/domain`: versioned object input and snapshot contracts
- `packages/shared`: provider-neutral shared types
- `docs/architecture`: architecture decision records
- `docs/runbooks`: deployment and operational instructions
- `docs/product`: product thesis and technical specification

## Environment rules

Browser code may only access `NEXT_PUBLIC_*` variables. `DATABASE_URL` and future service-role credentials are server-only. Production startup fails when required configuration is absent. Tests should inject explicit environment objects rather than mutate process-wide secrets.

## Object + Revision invariants

- Authenticated identities are provisioned into the `users` domain boundary on first use.
- New objects default to `PRIVATE`.
- Create, update, restore, and soft-delete append an immutable revision transactionally.
- Restore never rewrites history.
- `expectedRevisionId` and row locks prevent stale writes.
- Application owner filters and PostgreSQL RLS both isolate users.
- Public reads are not implemented; `PUBLIC` is currently only stored state and exposes nothing.

See `docs/runbooks/object-api.md` for the versioned API contract.

## Current boundary

The next milestone is the **Permission Engine**: explicit resource capabilities, authorization decisions, audit events, and negative cross-user tests shared by every future feature.
