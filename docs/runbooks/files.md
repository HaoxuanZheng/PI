# Capture and files runbook

Private file, image, and voice capture. Files belong to one canonical object and inherit that
object's authorization; there is no separate file grant.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | production | — | Server-only. Selects the Supabase Storage adapter. Without it, an in-process adapter is used for local development. |
| `STORAGE_BUCKET` | no | `lifegraph-private` | Must be a **private** bucket. |
| `STORAGE_REQUIRE_SCAN` | no | `true` | Blocks downloads until a scanner records `CLEAN`. Configuration rejects `false` in production. |

Create the bucket as private before first use. Public buckets are a Critical privacy defect: every
read must be a short-lived signed URL.

## API contract

All routes are authenticated and return `{ data }` or `{ error }` with an `x-request-id` header.

### `POST /api/v1/files/upload-intent`

Requires `EDIT` on the target object, which must be owned by the caller.

```json
{ "objectId": "uuid", "filename": "report.pdf", "mimeType": "application/pdf", "byteSize": 2048 }
```

Returns `201` with the `PENDING` file row and an upload ticket:

```json
{ "data": { "file": { "id": "uuid", "storageKey": "{ownerId}/{fileId}/report.pdf", "uploadStatus": "PENDING" },
            "upload": { "url": "https://...", "method": "PUT", "headers": { "content-type": "application/pdf" }, "token": "...", "expiresAt": "..." } } }
```

Upload the bytes directly to `url` with `method` and `headers`. The application never receives them.

Accepted types and limits:

| Category | Types | Limit |
| --- | --- | --- |
| `DOCUMENT` | `text/plain`, `text/markdown`, `application/pdf` | 25 MB |
| `IMAGE` | `image/png`, `image/jpeg`, `image/webp` | 15 MB |
| `AUDIO` | `audio/webm`, `audio/mpeg`, `audio/mp4`, `audio/wav` | 50 MB |

Anything else is `400 VALIDATION_FAILED`, as is an extension that disagrees with the declared type.

### `POST /api/v1/files/:fileId/complete`

```json
{ "checksum": "<64 hex sha256>", "byteSize": 2048 }
```

`byteSize` must equal the reserved size. Completing twice, or with a different size, is
`409 FILE_STATE_CONFLICT`.

### `POST /api/v1/files/:fileId/download`

Requires `READ`. Returns a short-lived signed URL. Refuses with `409 FILE_STATE_CONFLICT` when the
upload is incomplete, the scan verdict is `INFECTED`/`FAILED`, or the scan is still `PENDING` while
`STORAGE_REQUIRE_SCAN` is enabled.

### `GET /api/v1/files/:fileId` · `DELETE /api/v1/files/:fileId` · `GET /api/v1/objects/:objectId/files`

Metadata read (`READ`), delete (`EDIT`), and per-object listing (`READ`). Delete soft-deletes the row
and then removes the stored bytes.

## Verification

```bash
pnpm verify:capture   # required files and migration/repository invariants
pnpm test             # storage unit tests always run
```

Database-backed coverage requires a disposable database:

```bash
TEST_DATABASE_URL=postgresql://... pnpm test
```

`packages/db/tests/file-repository.integration.test.ts` asserts owner-prefixed keys, traversal
filenames being flattened, cross-user denial, size-mismatch rejection, scan gating in all three
states, `READ` sharing without attach rights, and deletion propagation through the object trigger.

## Operational notes

- **No scanner is wired yet.** With the default configuration, completed uploads are not downloadable
  until something calls `recordScanResult`. Run a scanner against the bucket and have it call that
  hook, or set `STORAGE_REQUIRE_SCAN=false` in development only.
- **Abandoned intents.** A storage failure after the intent commits leaves a `PENDING` row with no
  bytes. It is never downloadable. `purgeDeleted` reclaims rows once marked deleted.
- **Deletion.** Soft-deleting an object marks its files deleted via `objects_invalidate_files`, but
  the bytes are removed only when `purgeDeleted` runs. Schedule it with the other deletion
  propagation work.
- **Audit.** `FILE_UPLOAD_INTENT_CREATED`, `FILE_UPLOAD_COMPLETED`, `FILE_SCAN_RECORDED`, and
  `FILE_SOFT_DELETED` record structural metadata only. Filenames are deliberately excluded: a
  filename can itself be private content.
