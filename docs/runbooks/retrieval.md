# Retrieval + Embeddings V0.8

Configure `AI_API_KEY` and `AI_EMBEDDING_MODEL` (1536 dimensions). Apply migration `0006_retrieval.sql`. Owners can rebuild an object with `POST /api/v1/retrieval/index`. Authenticated users can run permission-scoped hybrid retrieval with `POST /api/v1/retrieval/search` and a query plus optional item/character budgets.

Verify that a READ grant makes an indexed object retrievable, revocation removes it immediately, a revision update invalidates old chunks, and soft deletion removes every chunk from active retrieval. Do not log queries, chunk contents, vectors, or returned private context.
