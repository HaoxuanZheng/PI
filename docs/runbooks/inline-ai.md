# Inline AI V0.7

Configure `AI_API_KEY`, `AI_MODEL`, and optionally `AI_BASE_URL`. In an editable object, select text inside a block, enter a command, inspect the complete before/after patch and evidence, then Accept or Reject. Accept must create exactly one `AI_ACCEPTED` revision. Edit the object in another tab before accepting to verify `REVISION_CONFLICT`. Use revision Restore to undo an accepted edit.

The operation APIs are server-generated only: `POST /api/v1/ai/operations/generate`, `POST /api/v1/ai/operations/:id/accept`, and `POST /api/v1/ai/operations/:id/reject`. Never log instructions, selected text, snapshots, or provider response bodies.
