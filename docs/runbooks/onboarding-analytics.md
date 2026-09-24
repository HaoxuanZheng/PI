# Onboarding + Analytics V0.18

## Onboarding

State is `start` → `select-goal` → `complete` on the users row (`GET`/`POST /api/v1/onboarding`), surfaced as a checklist in `/library`. Goals are `organize`, `living-profile`, `remember-people`, and `explore-history`. Activation means 10 or more objects; completion requires a goal but not activation, so import-driven users are never blocked. Each transition records its own analytics event for funnel observability. Suspended and deletion-pending accounts never reach onboarding because provisioning blocks those states first.

## Analytics

`POST /api/v1/analytics/events` accepts only allowlisted events (`analyticsEventSchema`, mirroring spec section 47). Metadata carries counts, ids, and decisions with values capped at 200 characters; any key resembling a body, transcript, snapshot, file, email, phone, or address fails validation before insert. Events are owner-isolated by RLS and stay in Postgres: there is no external pipeline in V0.18, so the founder observes activation and retention with direct queries. Never add note text, transcripts, or contact detail to an event, even temporarily.
