# LifeGraph

LifeGraph is a private-by-default Personal Internet: one user-owned source of truth that can power a private library, trusted AI assistance, and explicitly authorized public views.

This repository contains the **Foundation**, **Object + Revision Core**, **Permission Engine**, **Editor**, **Graph**, and **AI Infrastructure** milestones. Inline AI, retrieval, imports, and Living Identity are intentionally not implemented yet.

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

Open `http://localhost:3000`. The root page is public. `/auth` provides email/password sign-up and sign-in through the configured authentication provider. `/library` can create private notes, edit block snapshots with autosave, recover a local draft after refresh, compare immutable revisions, and restore an older snapshot as a new revision. `/api/health` reports application readiness without exposing secrets.

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
- `packages/permissions`: centralized capability decisions and permission schemas
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

## Permission invariants

- Every object read, update, restore, or delete passes through the centralized capability engine.
- Active USER grants can provide READ, COMMENT, EDIT, COLLABORATE, SHARE, or ADMIN capabilities.
- Only the owner can manage grants in V0.3; ADMIN cannot silently delegate access.
- Public grants cannot expose canonical objects. Anonymous pages must eventually use publication projections.
- Permission changes and sensitive object actions create metadata-only audit events.
- Application authorization and PostgreSQL RLS enforce the same direct-user access boundary.

See `docs/runbooks/permission-api.md` for the grant and revoke API.

## Editor invariants

- Manual saves send a complete validated snapshot and the expected current revision.
- Autosave is serialized and never overwrites a newer revision; HTTP 409 keeps the local draft for reconciliation.
- Each edit is written to local storage before its debounced network save, so refresh and transient disconnects do not discard the device-local draft.
- Identical snapshots are a no-op and do not create revision noise.
- Read-only users never receive editing or restore controls.
- Revision comparison is deterministic and restore requires explicit confirmation.

See `docs/runbooks/editor.md` for behavior and verification.

## Graph invariants

- Edges connect two existing canonical objects and never duplicate active source/target/type tuples.
- Creating and removing an outgoing edge requires EDIT on its source; creation also requires READ on its target.
- Related-object responses authorize both endpoints and PostgreSQL RLS independently filters them.
- Edge removal is a soft delete, and graph audit events never contain private object bodies.

See `docs/runbooks/graph-api.md` for the relationship API.

## AI infrastructure invariants

- Provider SDK calls stay behind `AIProvider`; structured results are always parsed again against Zod schemas.
- AI output is a proposal, never a database mutation or authoritative object snapshot.
- Safe patches use an allowlist of paths, verify `before` values, and validate the complete resulting snapshot.
- PENDING operations persist only after target EDIT, context READ, revision, manifest, and evidence checks.
- Proposal metadata is immutable and private to the creating user under RLS.
- V0.7 exposes only server-generated proposal, Accept, and Reject endpoints. AI still cannot write canonical objects without an explicit user Accept.
- V0.8 adds permission-first, revision-bound hybrid retrieval over reproducible embedding chunks.

See `docs/runbooks/ai-infrastructure.md` for adapter and operation rules.

## Current boundary

The next milestone is **Inline AI**: selection, command, schema-valid proposal generation, diff, and transactional Accept/Reject that creates an undoable `AI_ACCEPTED` revision. Full-text search remains adjacent infrastructure and must land before retrieval-backed AI context expands beyond explicitly selected objects.
