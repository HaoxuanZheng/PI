# Staging Deployment

## Goal

Deploy the web application to a Node.js-compatible platform and connect it to an isolated managed PostgreSQL/Supabase staging project. Staging must never share production data or credentials.

## Required configuration

- `NEXT_PUBLIC_APP_URL`: staging origin
- `NEXT_PUBLIC_SUPABASE_URL`: staging Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: staging public anonymous key
- `DATABASE_URL`: pooled staging PostgreSQL connection string, stored as a secret.
  The connected role must not be a superuser and must not hold `BYPASSRLS`:
  superusers bypass row-level security unconditionally, which turns tenant
  isolation into theater (`0025`). Grant the role `CONNECT`, `CREATE`, and
  `TEMPORARY` on the database plus full rights on the migrated schema, and
  install the `vector` extension once as a superuser.
- `SENTRY_DSN`: staging error-tracking DSN when enabled

## Procedure

1. Create an isolated staging PostgreSQL database with the `vector` extension available.
2. Configure Supabase email/password authentication and allowed redirect origins. Set the confirmation email template to link to `/auth/confirm?token_hash={{ .TokenHash }}&type=email` on `NEXT_PUBLIC_APP_URL`.
3. Store environment values in the deployment platform; do not commit them.
4. Run `pnpm install --frozen-lockfile` and `pnpm check` in CI.
5. Apply migrations using a one-off release command: `pnpm db:migrate`.
6. Deploy `apps/web` using `pnpm build` followed by `pnpm --filter @lifegraph/web start`. For self-hosted Docker/Node targets build with `STANDALONE=1` to emit the standalone output; leave it unset on Vercel, which manages its own output tracing.
7. Verify `/api/health` returns HTTP 200 and perform sign-up, confirmation, sign-in, protected-route, and sign-out smoke tests.
8. Verify `/api/ready` returns HTTP 200 (database-backed). Point load balancer and container probes at `/api/ready`, never at `/api/health` alone: health is liveness without secrets or database access, readiness fails traffic routing on database outage.

## Backups

Enable managed-database backups with a documented retention window before any production data exists. Rehearse at least one restore into an isolated database and boot the app against it. Backups retain user data until retention expires: the account-deletion response must state that window honestly rather than promising instant erasure everywhere. Never erase staging or production user data as an application rollback; database changes roll forward with reviewed fixes.

## Admin MFA (required before external alpha)

Managed auth owns MFA; the application never handles TOTP secrets.

1. In the Supabase dashboard for the staging project, enable MFA (TOTP) under Authentication settings.
2. Enroll MFA for every admin/owner account and require it for the Supabase dashboard organization.
3. Confirm `/api/health` still returns 200 and sign-in works with an MFA-enrolled admin account.
4. Repeat all three steps for the production project before inviting alpha users. Accounts without MFA must not hold admin access.

## Rollback

Roll back the application to the preceding immutable deployment. Database migrations require a reviewed forward fix unless a migration includes a separately tested reversible down procedure. Never erase staging or production user data as an application rollback.

## Current limitation

This repository does not contain provider-specific infrastructure-as-code because no deployment provider was selected. CI validates deployability; automatic staging deployment requires provider credentials and a selected platform.
