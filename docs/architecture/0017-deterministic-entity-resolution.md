# 0017 — Deterministic entity resolution

Status: accepted (V0.12)

## Context

Google Contacts cannot land without person deduplication. The specification is explicit (§21): the
system calculates candidate matches using deterministic signals **before** AI, AI may assist but
must not silently merge, and all merges must be reversible or auditable. Week 10's acceptance bar is
"duplicate contact resolution works".

Import idempotency (V0.11) already prevents one external record becoming two objects. It does
nothing about the harder case: the same human arriving from two different places, such as a Person
created by hand and the same person imported from Contacts.

## Decision

**Resolution proposes; a person decides.** Nothing merges automatically — not even an exact provider
id match, because two records agreeing on one identifier can still be distinct people in the user's
own model. AI is absent from this path entirely; every signal is deterministic and explainable.

**The strongest signal wins, rather than summing.** Weights are `PROVIDER_ID` 1.0, `EMAIL` 0.9,
`PHONE` 0.8, `NAME_AND_ORGANIZATION` 0.6, `NAME` 0.35, and a pair's score is the maximum, not the
total. Summing would let three weak agreements imitate an identifier; a shared common name plus a
shared city is not evidence of the same person.

**A bare name is recorded but never surfaced.** `NAME` alone falls below the proposal threshold, so
two unrelated people who happen to share a name never appear as a duplicate. A name only becomes a
proposal when an organisation corroborates it.

**Normalisation is conservative.** Emails are lowercased and trimmed but not provider-aliased —
stripping dots or `+` tags would silently merge addresses that a user may treat as distinct. Phones
compare on their last nine digits, so the same number stored with and without a country code matches.
Names are compared accent, case, and punctuation insensitively.

**Person detail is typed under `customFields.person`.** `personProfileSchema` gives resolution
validated fields to compare while leaving `schemaVersion: 1` and the generic snapshot contract
untouched. A fully typed per-type snapshot union is deferred.

**Merges reuse the revision path and are recorded.** The target absorbs the source's detail as a new
revision, and the source is soft-deleted with its own revision, so neither side loses history.
`entity_merges` stores the target's revision before and after plus the source's revision before, so
every merge is auditable and carries the state a reversal would need. Both sides require `EDIT`
through the permission engine, and the two objects are locked in a deterministic order so concurrent
merges cannot deadlock.

**A decision is durable.** The candidate pair is stored in canonical order under a unique index, and
a decided pair is never re-proposed, so "keep separate" stays separate across re-detection.

## Consequences

- Undo is **not** implemented, deliberately. Reversing a merge would need to un-delete the source
  object, but the deletion triggers from V0.10 and V0.8 have already invalidated its embeddings and
  marked its files deleted, and `purgeDeleted` may have removed the stored bytes. Shipping an undo
  that silently restores an object with missing attachments would be worse than recording the merge
  and leaving reversal to a later milestone that handles derived-data restoration properly.
- Detection compares in memory and is quadratic in the worst case, bounded at 2,000 people per run
  and reported through a `truncated` flag. A blocking index on email and phone keys is the next step.
- `mergePersonProfiles` keeps the target authoritative for scalar fields and unions the multi-valued
  ones, so no source value is silently discarded. Emails are unioned as written, which can leave two
  spellings of one address; normalisation happens at comparison time, not on write.
- Contacts with neither a name nor an email are rejected rather than imported as records the user
  cannot recognise, and a single unidentifiable contact is skipped instead of failing its page.
