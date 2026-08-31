# Imports runbook

One-directional import from external providers into the Personal Graph. Nothing is ever written back
to a provider, and imported content is always `PRIVATE`.

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_DRIVE_ACCESS_TOKEN` | for Drive imports | Server-only read-only Drive token (`drive.readonly`). |
| `GOOGLE_CONTACTS_ACCESS_TOKEN` | for Contacts imports | Server-only read-only People API token (`contacts.readonly`). |
| `NOTION_API_TOKEN` | for Notion imports | Server-only Notion integration token. Only pages shared with the integration are visible. |

There is still no OAuth consent flow, so every provider token is operator-supplied.

A provider without its token returns `501 IMPORT_PROVIDER_UNAVAILABLE`. All three providers are
implemented; `GOOGLE_DRIVE`, `GOOGLE_CONTACTS`, and `NOTION` are the accepted values.

## API contract

### `POST /api/v1/imports/start`

```json
{ "provider": "GOOGLE_DRIVE" }
```

Reserves a run and processes its first batch. Returns `201`:

```json
{ "data": { "import": { "id": "uuid", "status": "RUNNING", "importedCount": 2, "skippedCount": 0,
                        "errorCount": 0, "cursorState": { "cursor": "page-2" } },
            "done": false } }
```

`409 IMPORT_STATE_CONFLICT` if a run for that provider is already `PENDING` or `RUNNING`.

### `POST /api/v1/imports/:importId/continue`

Processes the next batch from the stored cursor. **Repeat until `done` is true** — batches are driven
by explicit requests in V0.11, not a background worker.

### `POST /api/v1/imports/:importId/resume`

Re-opens a `FAILED` run at its stored cursor and processes the next batch. Only a failed run can be
resumed; `409` otherwise.

### `GET /api/v1/imports` · `GET /api/v1/imports/:importId`

List runs, or read one. Runs are private to their owner; another user's run is `404`.

## Behaviour

- **Idempotent.** Each record carries a SHA-256 hash of its mapped content. Unchanged → `SKIP`,
  changed → `UPDATE` (new revision), new → `CREATE`. Re-running a completed import over unchanged
  sources yields `skippedCount` equal to the record count and creates no objects.
- **Private.** Imported objects are written `PRIVATE` with `createdByType = IMPORT`. The importer
  cannot set visibility.
- **Per-record tolerance.** A single bad record increments `errorCount`, is recorded in
  `errorSummary` (capped at 20), and does not abort the batch. A provider-level failure fails the run
  and preserves the cursor.
- **Drive mapping.** Google Docs and text-like files become `NOTE` with exported text; images become
  `PHOTO`, audio becomes `VOICE_NOTE`, everything else including PDFs becomes a metadata-only `FILE`.
  Trashed files are skipped. Raw provider metadata is kept under `customFields.source`.
- **Contacts mapping.** Each contact becomes a `PERSON` with typed detail under
  `customFields.person`. A contact with neither a name nor an email is skipped.
- **Notion mapping.** Pages become `NOTE` with top-level textual blocks as the body. A *database*
  page with a title and a populated email property becomes a `PERSON`, so it feeds entity resolution.
  Properties are flattened into `customFields.source.properties` and are part of the content hash.
  Archived and trashed pages are skipped, and the API version is pinned to `2022-06-28`. Only
  top-level blocks are read: nested trees, tables, and embeds are not represented.

After importing people, run `POST /api/v1/entities/detect` to surface duplicates
(`docs/runbooks/entities.md`).

## Verification

```bash
pnpm verify:imports   # required files and migration/repository invariants
pnpm test             # provider and idempotency unit tests always run
```

Database-backed coverage requires a disposable database:

```bash
TEST_DATABASE_URL=postgresql://... pnpm test
```

`packages/db/tests/import-repository.integration.test.ts` asserts the specification's acceptance
criteria: a two-page run, imported objects being `PRIVATE` and `IMPORT`-attributed, a replay creating
zero duplicates, a changed source appending a revision instead of duplicating, one live run per
provider, cursor-preserving failure with successful resume, and cross-user isolation.

## Operational notes

- **No OAuth flow.** Provider tokens are a stopgap. Real per-user access needs the consent flow plus
  encrypted refresh-token storage, which is not built.
- **Notion costs an extra request per page** to read its blocks, so a large workspace needs many
  `continue` calls and may meet Notion's rate limits. A failure preserves the cursor and resumes.
- **No background worker.** Long imports need repeated `continue` calls. Moving batch execution into
  a job runner is the natural follow-up.
- **Imported binaries have no bytes.** Drive imports do not yet create `files` rows, so a PDF is a
  metadata-only object. Wiring imports through the capture path (`docs/runbooks/files.md`) is
  outstanding.
- **No entity resolution.** Person dedupe (§21) is required before Google Contacts can land.
- **Audit.** `IMPORT_STARTED`, `IMPORT_COMPLETED`, `IMPORT_RESUMED`, and `IMPORT_FAILED` record the
  run id, provider, and counts only — never imported content.
