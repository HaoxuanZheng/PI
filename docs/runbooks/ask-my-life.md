# Ask My Life V0.9

Apply all migrations through V0.8, configure the chat and embedding models, and index test objects. Open `/ask` or call `POST /api/v1/ask` with `{ "question": "..." }`. Confirm supported answers link to readable Library objects and exact revision IDs. Remove evidence or ask about two similarly named Person objects to verify abstention and disambiguation.

The bundled curated suite measures deterministic safety-gate behavior against a 75% baseline; it does not claim semantic answer-quality performance. A provider-backed quality evaluation with representative user data remains required before production launch. Never log questions, retrieved content, answers, or citation excerpts.
