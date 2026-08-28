# ADR 0013: Retrieval is permission-first and revision-bound

- Status: Accepted

Derived chunks carry owner, object, and source revision identity. PostgreSQL RLS determines the readable object search space before hybrid ranking. Active search additionally requires the chunk revision to equal the object's current revision. An object trigger invalidates chunks whenever its revision advances or deletion begins. Embeddings are reproducible derived data, never authoritative content.
