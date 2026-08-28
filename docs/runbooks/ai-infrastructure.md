# AI Infrastructure V0.6

Provider adapters implement `AIProvider`; provider SDK imports must remain inside the adapter. Call `generateValidatedStructured` with a registered prompt version and schema. Never parse model prose into authoritative mutations.

Persist proposals through `createAIOperationRepository().createPending` only after generation. It validates target identity, optimistic revision bases, permissions, context manifests, evidence, and structured output. Invalid output is rejected before the insert. General logs must include operation ID, provider/model, timing, and status only—never instructions, snapshots, or retrieved private text.

Authenticated read-only diagnostics are available at `GET /api/v1/ai/operations` and `GET /api/v1/ai/operations/:id`. There is deliberately no POST, Accept, or Reject route in V0.6.
