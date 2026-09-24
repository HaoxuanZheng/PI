# Account Export + Deletion V0.16–V0.17

## Export

`POST /api/v1/account/export` with `{ format: "JSON" | "MARKDOWN" }` assembles every user-owned collection in one transaction: objects, revisions, relationships, files, publications, imports, AI operations, merge candidates, merges, grants issued, and audit events. Soft-deleted rows are included as complete history; derived embeddings are excluded as reproducible. The bundle is checked with `assertBundleOwnership` before return, so a mixed bundle aborts instead of shipping. JSON is authoritative, MARKDOWN is a readable companion. The route sits in the `EXPORT` bucket (3/hour). Each export audits `ACCOUNT_EXPORTED` with counts only, never content.

## Deletion

Deleting an object (`DELETE /api/v1/objects/:id` with the expected revision) appends an immutable `DELETE` revision, tombstones both directions of its relationships, and invalidates embeddings, files, and publications through database triggers. Owners keep `READ` on their own deleted objects for history and audit; every other actor and action is denied, and grantees lose access immediately.

Account deletion is a request with a 7-day recovery window, not an immediate purge. `POST /api/v1/account/delete` requires `{ confirm: true, acknowledgement: "DELETE MY ACCOUNT" }` and sets `DELETION_PENDING`, which disables every other route at provisioning. `GET` reports status and `DELETE` cancels inside the window; both explicitly allow the pending state. Purge execution (storage bytes, embeddings, backups, provider tokens) is not implemented yet: never tell a user their data is already gone.
