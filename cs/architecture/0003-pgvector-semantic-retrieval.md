# ADR 0003: pgvector for semantic retrieval

- Status: Accepted
- Date: 2026-08-28

## Context

Future semantic search should combine vector similarity with full-text, structured, and graph-aware filters without introducing a second search system prematurely.

## Decision

Enable pgvector in PostgreSQL and store derived embeddings with owner, source, chunk, model, and version metadata. Authorization filters run before records become AI context. Deletion and visibility changes enqueue invalidation of affected vectors.

## Consequences

Hybrid retrieval stays close to authoritative data and operationally simple. Index tuning and a separate search service remain future decisions driven by measured scale.
