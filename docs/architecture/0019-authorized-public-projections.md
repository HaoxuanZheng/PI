# 0019 — Authorized public projections

Status: accepted (V0.14)

## Context

Living Identity (specification §28–§31, week 11) is the first milestone where private data becomes
reachable by an anonymous reader. Every prior milestone could rely on one rule — authenticate, then
authorize — and `PUBLIC` visibility was inert stored state that exposed nothing.

The specification is unambiguous (§3.4): public data is an authorized projection, never a private
payload hidden by the browser. The week 11 acceptance bar is "private data absent from public API
response". A mistake here is a Critical privacy defect, not a bug.

## Decision

**Public reads come from `publications` and nowhere else.** `createPublicReadRepository` queries a
single table. It never sets an owner context, never joins `objects`, `object_revisions`, or `users`,
and returns the stored projection verbatim. An anonymous request therefore cannot reach a canonical
record even if a projection were built incorrectly — the leak would have to be persisted first, and
the projection layer is what prevents that.

The verify gate enforces this statically: it reads the public section of the repository and fails the
build if it mentions `setOwnerContext`, `objectRevisions`, `from(objects)`, or `users.`, and fails if
any public page imports an authenticated repository.

**The projection is an allowlist, not a denylist.** `publicObjectFields` is `title`, `summary`,
`body`, `tags`. A field added to the snapshot contract in future is private by default and stays
private until deliberately added here. `customFields` is absent by construction, which matters
because it carries person emails, phone numbers, and raw provider metadata from the importers.

**Naming a forbidden field is a loud failure.** Requesting `customFields`, `person`, `source`, or
`schemaVersion` throws rather than being silently dropped, so a mistake surfaces in a test instead of
shipping as a quiet omission. An unknown field is likewise rejected rather than ignored.

**A PERSON object can never be published.** Contact records exist to hold emails and phone numbers,
so publishing one is refused outright rather than relying on field selection to exclude them.

**The handle is denormalised onto the publication.** An anonymous reader resolving `/@username` must
not query `users`, because row-level security is row level and not column level: a policy permitting
anonymous access to a user row would expose that row's email alongside its username. Storing the
handle on the publication keeps the public path single-table.

**Publishing is explicit and revision-bound.** It requires `SHARE`, a literal `confirm: true`, and
the caller's `expectedRevisionId`, so a concurrent edit cannot be published unseen. Preview runs the
same projection function that publishing stores, so a preview is exactly what outsiders will see.

**A publication is frozen, not live.** It stores a projection bound to a specific revision, so later
edits to the source do not silently change what is public. Drift is reported through a staleness
query for the owner to act on.

**Deleting an object unpublishes it.** The `objects_unpublish_on_delete` trigger flips affected
publications to `UNPUBLISHED`, mirroring embedding invalidation and file cascade. Without it a
deleted record would remain publicly readable through its frozen projection.

## Consequences

- Anonymous readers can confirm that a handle has a published profile, which is inherent to a public
  profile at a guessable URL. Nothing beyond the projection is observable, and unpublished or
  never-published handles are indistinguishable from absent ones.
- `/@username` is served by a root-level dynamic segment, because App Router treats a leading `@` in
  a directory name as a parallel-route slot. Static routes such as `/library` and `/ask` take
  precedence, and a segment without an `@` prefix is a 404.
- Profiles are a view configuration over source objects (§30), not a second resume store. Section
  membership references object ids; there is no duplicated experience table.
- QR and NFC sharing is a URL concern: `profileShareUrl` and `objectShareUrl` produce the canonical
  payload. No QR image encoder is bundled, so rendering the code is a client responsibility.
- Field-level visibility (§12) remains object-level plus publication field selection. The data model
  does not preclude a finer policy later.
- **Not covered by any automated check:** the specification calls for legal and compliance review
  before public launch (§56). This milestone makes publication technically possible; it does not
  discharge that review.
