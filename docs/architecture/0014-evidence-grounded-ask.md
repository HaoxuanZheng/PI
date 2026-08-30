# ADR 0014: Ask My Life is an evidence pipeline, not a chatbot

- Status: Accepted

Questions are classified before permission-first retrieval. Only retrieved, revision-bound chunks enter answer generation. Supported answers require citations whose object/revision identities occur in the retrieval set and whose excerpts are exact substrings of retrieved content. Missing evidence, unverifiable output, and ambiguous people return a low-confidence abstention or clarification request. Questions and answers are not persisted by default.
