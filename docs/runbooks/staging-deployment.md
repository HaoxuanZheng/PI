# Staging Deployment

## Goal

Deploy the web application to a Node.js-compatible platform and connect it to an isolated managed PostgreSQL/Supabase staging project. Staging must never share production data or credentials.

## Required configuration

- `NEXT_PUBLIC_APP_URL`: staging origin
- `NEXT_PUBLIC_SUPABASE_URL`: staging Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: staging public anonymous key
- `DATABASE_URL`: pooled staging PostgreSQL connection string, stored as a secret
- `SENTRY_DSN`: staging error-tracking DSN when enabled

## Procedure

1. Create an isolated staging PostgreSQL database with the `vector` extension available.
2. Configure Supabase email/password authentication and allowed redirect origins. Set the confirmation email template to link to `/auth/confirm?token_hash={{ .TokenHash }}&type=email` on `NEXT_PUBLIC_APP_URL`.
3. Store environment values in the deployment platform; do not commit them.
4. Run `pnpm install --frozen-lockfile` and `pnpm check` in CI.
5. Apply migrations using a one-off release command: `pnpm db:migrate`.
6. Deploy `apps/web` using `pnpm build` followed by `pnpm --filter @lifegraph/web start`.
7. Verify `/api/health` returns HTTP 200 and perform sign-up, confirmation, sign-in, protected-route, and sign-out smoke tests.

## Rollback

Roll back the application to the preceding immutable deployment. Database migrations require a reviewed forward fix unless a migration includes a separately tested reversible down procedure. Never erase staging or production user data as an application rollback.

## Current limitation

This repository does not contain provider-specific infrastructure-as-code because no deployment provider was selected. CI validates deployability; automatic staging deployment requires provider credentials and a selected platform.
