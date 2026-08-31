# LifeGraph

LifeGraph is a private-by-default Personal Internet: one user-owned source of truth that can power a private library, trusted AI assistance, and explicitly authorized public views.

This repository contains the **Foundation**, **Object + Revision Core**, **Permission Engine**, **Editor**, **Graph**, **AI Infrastructure**, **Inline AI**, **Embeddings + Retrieval**, **Ask My Life**, **Capture + Files**, the **Import Framework**, and **Entity Resolution + Contacts** milestones. The Notion importer, Living Identity, sharing, and alpha hardening are intentionally not implemented yet.

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
- `packages/storage`: upload validation, storage key derivation, and the object storage port
- `packages/imports`: provider contract, content hashing, and the Google Drive and Contacts adapters
- `packages/entities`: deterministic person matching signals and profile merging
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
- V0.9 adds evidence-grounded Ask My Life with classification, citations, abstention, and person disambiguation.

See `docs/runbooks/ai-infrastructure.md` for adapter and operation rules.

## Capture and file invariants

- A file belongs to exactly one canonical object and inherits that object's authorization; attaching requires EDIT and reading requires READ.
- Storage keys are derived on the server as `{ownerId}/{fileId}/{sanitizedFilename}`; a database CHECK repeats the owner prefix rule.
- Content types are an allowlist with per-category size limits, and a declared type must agree with its extension.
- Uploads are two-phase: an intent reserves a `PENDING` row, and completion records the confirmed size and a SHA-256 digest.
- Downloads are short-lived signed URLs and are refused until a scanner records `CLEAN`; production cannot disable that gate.
- Deleting a file removes the stored bytes, and deleting an object cascades to its attachments.

See `docs/runbooks/files.md` for the upload, download, and deletion contract.

## Import invariants

- One external record maps to at most one live object per owner and provider, enforced by a partial unique index.
- Idempotency is a SHA-256 hash of mapped content: unchanged sources are skipped, changed sources append a revision, and a replayed import creates no duplicates.
- Imported objects are always written `PRIVATE` with `createdByType = IMPORT`; an importer cannot set visibility.
- Each batch commits its cursor, so an interrupted or failed run resumes rather than restarting.
- Only one `PENDING`/`RUNNING` run exists per user and provider.
- A single bad record is recorded and skipped; only a provider-level failure fails the run.
- Providers only read and normalise, and never write to the database.

See `docs/runbooks/imports.md` for the import API and operational limits.

## Entity resolution invariants

- Duplicate detection uses deterministic signals only; AI is not involved in this path.
- A pair's score is its strongest signal, never a sum, so weak agreements cannot imitate an identifier.
- A shared name alone never surfaces as a duplicate; an organisation must corroborate it.
- Nothing merges automatically, including an exact provider id match. Every merge is an explicit user decision.
- A merge appends a revision to the surviving object and soft-deletes the other with its own revision, so neither loses history.
- Every merge records the revisions on both sides, making it auditable. Both objects require EDIT.
- A decided pair is never re-proposed, so "keep separate" is durable.

See `docs/runbooks/entities.md` for the detection and merge API.

## Current boundary

Milestones through **Entity Resolution + Contacts** (V0.12) are implemented. The Notion importer, Living Identity, sharing, and alpha hardening are intentionally not implemented yet.

Deliberate gaps are recorded in the architecture decision records: there is no OAuth consent flow, so Drive and Contacts use operator-supplied read-only tokens (`0016`); import batches are driven by explicit requests rather than a background worker (`0016`); imported binaries do not yet create `files` rows (`0016`); and merge undo is not exposed, because reversing a merge cannot yet restore the source object's invalidated embeddings and file bytes (`0017`).

The next milestone is the **Notion importer**, which adds no new concepts on top of the import contract. **Living Identity** follows, and it is the first milestone where private data becomes an authorized public projection, so it must not reuse any canonical object read path.
