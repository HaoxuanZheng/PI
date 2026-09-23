# 0025 Least-Privilege Database Roles

## Discovery

The first real execution of the database-backed integration tests (V0.20 CI)
failed tenant isolation while connected as the `postgres` superuser.
PostgreSQL superusers bypass row-level security unconditionally —
`FORCE ROW LEVEL SECURITY` constrains table owners, never superusers.
Every cross-user assertion therefore passed vacuously: the tests proved
nothing about isolation.

## Decision

- Integration tests and the application connect as a least-privilege role
  that owns the migrated schema but holds no superuser or `BYPASSRLS`
  attribute. CI creates the `app` role, transfers database ownership to it,
  and pre-installs the `vector` extension (only superusers can), then runs
  the suite as `app` so RLS is genuinely enforced.
- Production and staging deployments must follow the same rule: the
  `DATABASE_URL` role must not be a superuser and must not hold `BYPASSRLS`.
  Managed providers usually need a `GRANT` pass for the extension; the
  staging runbook records the requirement.

## Consequences

First execution under the new role found three genuine defects that the
superuser runs had masked:

- `retrieval.search` and `files.purgeDeleted` interpolated JS arrays into
  `ANY(${ids}::uuid[])`, which postgres.js expands to a record and rejects.
  Both now use `IN` with `sql.join` and an explicit separator.
- `object_revisions` has SELECT and INSERT policies only (since `0002`), so
  the immutability test's raw UPDATE met RLS-deny rather than the trigger.
  The test now asserts the secure outcome: zero rows updated or deleted.
- `permissions.can` denied every capability on soft-deleted objects, making
  post-merge history unreadable despite the "neither loses history"
  invariant. Owners retain `READ` on their own deleted objects; every other
  actor and action is still denied, and `get` still 404s through the
  live-read path.

## Verification

`TEST_DATABASE_URL` against a disposable database as a non-superuser role:
21 files, 129 tests, zero skips. CI runs this on every push.
