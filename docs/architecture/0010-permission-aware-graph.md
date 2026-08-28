# ADR 0010: Permission-aware object graph

- Status: Accepted
- Date: 2026-08-28

Edges are first-class, soft-deletable records between canonical objects. Creating or removing an outgoing edge requires EDIT on its source and READ on its target. Reading related items requires READ on the requested object, and every opposite endpoint is authorized again before being returned. PostgreSQL RLS independently requires both endpoints to be visible.

V0.5 supports deterministic user-created relationships only. AI-proposed edges, entity resolution, search ranking, transitive traversal, and public graph projections remain separate future operations. Duplicate active typed edges and self-edges are rejected. Audit events contain IDs and relationship types, never object bodies.
