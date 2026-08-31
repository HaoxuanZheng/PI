# Entity resolution runbook

Deterministic person deduplication. Resolution produces reviewable proposals; **nothing ever merges
automatically**, and AI is not involved in this path.

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_CONTACTS_ACCESS_TOKEN` | for Contacts imports | Server-only read-only People API token (`contacts.readonly`). As with Drive, there is no OAuth consent flow yet. |

## Signals

| Signal | Weight | Proposes? |
| --- | --- | --- |
| `PROVIDER_ID` | 1.00 | yes (HIGH) |
| `EMAIL` | 0.90 | yes (HIGH) |
| `PHONE` | 0.80 | yes (HIGH) |
| `NAME_AND_ORGANIZATION` | 0.60 | yes (MEDIUM) |
| `NAME` | 0.35 | **no** — a shared name alone is noise |

A pair's score is the **strongest** signal, not the sum, so weak agreements cannot imitate an
identifier. Emails are lowercased only (no dot or `+` aliasing); phones compare on their last nine
digits; names compare accent, case, and punctuation insensitively.

## API contract

### `POST /api/v1/entities/detect`

Recomputes proposals across the caller's people. Returns counts:

```json
{ "data": { "compared": 42, "proposed": 3, "created": 1, "truncated": false } }
```

`truncated` is true when more than 2,000 people were present and comparison was capped. Detection is
idempotent — a pair already proposed or already decided is not proposed again.

### `GET /api/v1/entities/candidates`

Pending proposals, strongest first, each with `score`, `confidence`, `signals`, and the two object
ids.

### `POST /api/v1/entities/candidates/:candidateId/decide`

```json
{ "decision": "MERGE", "targetObjectId": "uuid" }
```

or

```json
{ "decision": "SEPARATE", "targetObjectId": null }
```

`targetObjectId` is required for `MERGE` and must be one of the candidate's two objects — the caller
chooses which record survives. `409 MERGE_STATE_CONFLICT` if the candidate was already decided.

**Merge behaviour.** The target absorbs the source's contact detail as a new revision; scalar fields
keep the target's value (filling from the source only where the target is empty) and multi-valued
fields are unioned. The source is soft-deleted with its own revision, so its history survives. Both
sides require `EDIT`.

**Keep separate is durable.** The pair is never proposed again.

## Verification

```bash
pnpm verify:entities   # required files and migration/repository invariants
pnpm test              # signal scoring and contact mapping always run
```

Database-backed coverage requires a disposable database:

```bash
TEST_DATABASE_URL=postgresql://... pnpm test
```

`packages/db/tests/entity-repository.integration.test.ts` asserts deterministic proposal from a
shared email, canonical pair ordering, idempotent re-detection, cross-owner isolation, rejection of
an out-of-pair merge target, profile union on merge, source soft-deletion with history intact, merge
auditability, and that "keep separate" survives re-detection.

## Operational notes

- **Undo is not implemented.** Merges are auditable — `entity_merges` records the target's revision
  before and after and the source's revision before — but reversal is not exposed. Un-deleting the
  source would not restore its embeddings or file bytes, which the V0.8 and V0.10 deletion triggers
  have already invalidated. See the ADR for the reasoning.
- **Detection is quadratic and capped** at 2,000 people per run. Watch the `truncated` flag; a
  blocking index on email and phone keys is the next step.
- **Run detection after an import.** It is not automatic. A Contacts import followed by
  `POST /entities/detect` is the intended sequence.
- **Audit.** `ENTITY_CANDIDATES_DETECTED`, `ENTITY_MERGED`, and `ENTITY_KEPT_SEPARATE` record ids and
  counts only — never contact detail such as names, emails, or phone numbers.
