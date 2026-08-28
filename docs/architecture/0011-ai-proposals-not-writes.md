# ADR 0011: AI proposals are not authoritative writes

- Status: Accepted
- Date: 2026-08-28

All model calls pass through a provider-neutral `AIProvider`. Structured responses are parsed against an explicit Zod schema even if an SDK claims a generic return type. Initial patches allow only add, remove, and replace against `/title`, `/summary`, `/body`, and `/tags`; deterministic code checks `before` preconditions and validates the resulting complete object snapshot.

Before a valid PENDING operation is stored, application code verifies EDIT on the target, READ on every permitted context object, current target/context revisions, and that every evidence citation exists in the retrieval manifest. The operation proposal and context metadata become immutable. The model has no database credentials and V0.6 exposes no public operation-creation endpoint or acceptance mutation.

Inline AI V0.7 will add proposal generation UX and transactional Accept/Reject. Only acceptance may create an `AI_ACCEPTED` immutable revision.
