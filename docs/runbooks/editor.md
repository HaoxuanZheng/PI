# Editor V0.4 runbook

## Save contract

`PATCH /api/v1/objects/:objectId` remains the deterministic save operation. Send the complete `snapshot` plus `expectedRevisionId`. Success returns the object and its current revision. A stale base returns HTTP 409 with `REVISION_CONFLICT`; reload only after preserving or copying the local draft.

Autosave waits 900 ms after a change and serializes requests. The local draft key is `lifegraph:draft:<objectId>`. A successful save removes that key only when the saved snapshot is still the latest local state.

## Manual verification

1. Sign in, create a private note, and open it.
2. Add a heading and text block; confirm the status moves through unsaved, saving, and saved.
3. Refresh immediately after typing; confirm the local draft is recovered and then saved.
4. Open the same object in two tabs. Save in tab A, then edit tab B; confirm tab B shows a conflict and retains its draft.
5. Compare an older revision with current and inspect title, summary, tags, and block changes.
6. Select Restore; cancel once, then confirm. Verify a new RESTORE revision appears and older revisions remain unchanged.
7. Grant another user READ only and confirm that user sees no editor or restore control. Grant EDIT and confirm autosave becomes available.

Local drafts are browser-device recovery only. They are not encrypted separately from the browser profile and are not cross-device synchronized.
