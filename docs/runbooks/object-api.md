# Object + Revision API

All endpoints require an authenticated Supabase session. Responses include `x-request-id`; errors use the specification's structured error envelope. Access to another user's object returns `NOT_FOUND` to avoid confirming its existence.

## Create

`POST /api/v1/objects`

```json
{
  "snapshot": {
    "schemaVersion": 1,
    "type": "NOTE",
    "title": "First note",
    "body": { "format": "plain_text", "content": "Private context" },
    "tags": [],
    "customFields": {}
  }
}
```

Visibility defaults to `PRIVATE`. The response contains both the object metadata and its `CREATE` revision.

## Read and list

- `GET /api/v1/objects?limit=50`
- `GET /api/v1/objects/:objectId`
- `GET /api/v1/objects/:objectId/revisions`

Soft-deleted objects are absent from normal reads and lists.

## Update

`PATCH /api/v1/objects/:objectId`

```json
{
  "expectedRevisionId": "00000000-0000-4000-8000-000000000000",
  "snapshot": {
    "schemaVersion": 1,
    "type": "NOTE",
    "title": "Revised title",
    "body": { "format": "plain_text", "content": "Revised content" },
    "tags": [],
    "customFields": {}
  }
}
```

A stale `expectedRevisionId` returns HTTP 409 with `REVISION_CONFLICT`.

## Restore

`POST /api/v1/objects/:objectId/restore`

```json
{
  "revisionId": "00000000-0000-4000-8000-000000000001",
  "expectedRevisionId": "00000000-0000-4000-8000-000000000002"
}
```

Restore copies the chosen snapshot into a new immutable `RESTORE` revision.

## Soft delete

`DELETE /api/v1/objects/:objectId`

```json
{ "expectedRevisionId": "00000000-0000-4000-8000-000000000002" }
```

Deletion appends a `DELETE` revision, marks the object deleted, tombstones both directions of its relationships, and invalidates embeddings, files, and publications through database triggers. Owners keep `READ` on their own deleted objects for history; everyone else is denied.

## Idempotency

`POST /api/v1/objects` accepts an `Idempotency-Key` header (1-64 URL-safe characters). A retried request with the same key receives the stored response with an `x-idempotent-replay` marker instead of creating a duplicate object. A duplicate arriving while the first is still executing fails with `IDEMPOTENCY_CONFLICT` (HTTP 409, retry after one second). Keys are per-user, live 24 hours, and only successful responses are stored: handler errors drop the reservation so the retry proceeds.
