# LifeGraph Engineering Rules

## Product invariant

The user owns one durable Personal Graph. AI may propose changes but never silently becomes the authority. New information is private by default, and public identity is an explicitly authorized projection of the same source data.

## Architecture

- Keep a TypeScript modular monolith. Do not introduce microservices without a measured scaling need.
- PostgreSQL is the authoritative source of truth. Use Drizzle and committed SQL migrations.
- Keep provider-specific authentication, AI, storage, and job code behind package interfaces.
- Use pgvector only for derived semantic retrieval; vectors are never authoritative records.

## Privacy and authorization

- Enforce authorization before querying or retrieving private content.
- Never depend on frontend hiding as an access-control boundary.
- New objects and imported data must default to `PRIVATE`.
- Never log raw private content in general application logs.
- Deletion workflows must remove derived search, embedding, cache, and AI context data.
- Add automated tests for every security-sensitive behavior.

## AI and data integrity

- LLM output must pass schema, authorization, and business-rule validation.
- AI produces proposed patches only. A user must Accept, Reject, or Edit a proposal.
- Every accepted authoritative change creates an immutable revision.
- Restore creates a new revision; it never rewrites history.
- Personal Graph answers should expose evidence references where practical.

## Code quality

- Prefer small, reversible vertical slices and existing repository patterns.
- Validate all external input and environment configuration.
- Update docs, tests, migrations, and rollback notes with behavior changes.
- Do not add social, ranking, ticketing, ambient recording, biometrics, or autonomous publishing to the MVP.

## Before finishing

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Report failures, permission/privacy impact, limitations, and the exact next task.
