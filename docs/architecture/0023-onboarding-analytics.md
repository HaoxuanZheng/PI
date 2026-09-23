# 0023 Onboarding and Product Analytics

## Decision

Onboarding is a small state machine on `users` plus a privacy-safe analytics
table, surfaced as a checklist in the library rather than a separate wizard.

## Rules

- State is three columns: `onboarding_started_at`, `onboarding_goal`
  (`organize` | `living-profile` | `remember-people` | `explore-history`),
  `onboarding_completed_at`, with CHECK constraints on the goal set and the
  started-before-completed timeline. Status is one row lookup plus an object
  count; activation is `objectCount >= 10` per the specification.
- Transitions are explicit: `start`, `select-goal`, `complete`. Each writes
  its own analytics event (`onboarding_started`, `onboarding_goal_selected`,
  `onboarding_completed`) so the funnel is observable without extra calls.
- Analytics events are an allowlist (`analyticsEventSchema`, mirroring spec
  section 47). Unknown events fail validation; they are never silently stored.
- Metadata carries counts, ids, and decisions only. `assertSafeMetadata`
  rejects any key resembling a body, transcript, snapshot, file, email,
  phone, or address before insert, and values are capped at 200 characters.
  Analytics never carries private content by construction, not by convention.
- `analytics_events` is owner-isolated by RLS like every other user table.
  There is no admin dashboard in V0.18; the founder observes activation via
  direct queries, which is sufficient for 20 alpha users.
- The library checklist is progressive: start, choose a goal, create or
  import toward 10 objects, then mark complete. Completion requires a goal
  but not activation, so a user who imports value differently is not blocked.

## Non-goals

- No AI-analyzed suggestions, no 3-connections demo, no suggested questions
  yet (spec 5.1 full flow). Those need retrieval and ask integration and are
  future slices.
- No event pipeline to an external analytics tool; events stay in Postgres.
- No onboarding for suspended or deletion-pending accounts: provisioning
  blocks those states before onboarding is reachable.

## Verification

`pnpm verify:alpha-onboarding`, `pnpm db:check`, `pnpm test`, `pnpm build`.
Migration `0013` is unverified against a real PostgreSQL instance without
`TEST_DATABASE_URL`.
