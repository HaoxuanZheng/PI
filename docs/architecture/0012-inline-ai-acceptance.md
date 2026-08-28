# ADR 0012: Inline AI acceptance is the authority boundary

- Status: Accepted

AI generation creates a validated, immutable PENDING proposal against one exact revision. The provider cannot access the database. Accept locks both operation and object, rechecks EDIT and the base revision, deterministically applies the safe patch, appends one `AI_ACCEPTED` revision, advances the object, and completes the operation in one transaction. Reject completes the operation without touching the object. A unique database index prevents one operation from creating multiple revisions.
