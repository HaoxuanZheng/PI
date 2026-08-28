# Graph V0.5 API

## Endpoints

- `GET /api/v1/objects/:id/relationships` — visible incoming and outgoing edges with authorized related objects.
- `POST /api/v1/objects/:id/relationships` — create an outgoing edge with `targetObjectId`, `relationshipType`, and optional `label`.
- `DELETE /api/v1/objects/:id/relationships/:relationshipId` — soft-delete an outgoing edge.

Create and delete require EDIT on the source. Create also requires READ on the target. Denials are returned as NOT_FOUND to avoid object enumeration.

Verify manually by creating Person, Event, Project, and Skill objects; connect Person→Event with ATTENDED and Project→Skill with USES_SKILL; confirm both incoming and outgoing views appear. Remove one edge and confirm it disappears without deleting either object. A user who cannot read the opposite endpoint must never receive that edge or object.
