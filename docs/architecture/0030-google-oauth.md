# 0030 Google OAuth Consent

## Decision

Implement the Google authorization-code dance against the V0.23 vault,
rather than another token field, so Drive and Contacts imports stop
depending on operator-supplied tokens per user.

## Rules

- `GET /connections/google/start?provider=` mints a 64-hex single-use
  state bound to the caller (10-minute TTL) and redirects to Google with
  read-only scopes (`drive.readonly`, `contacts.readonly`), `offline`
  access, and consent prompt. Consent happens on Google's pages; the app
  never sees Google passwords.
- `GET /connections/google/callback?code&state` consumes the state exactly
  once for its owning user, exchanges the code, and seals both tokens.
  Expired, unknown, foreign-user, or replayed states fail closed to
  `/library?error=...`; no token material ever appears in URLs, logs, or
  error pages.
- Expired rows with a refresh token rotate transparently inside `liveToken`
  when Google credentials are configured; the vault row updates in the same
  transaction. Revoked or failed refreshes degrade to absence so importers
  fall back to operator tokens instead of sending dead ones. Rows without a
  refresh token simply expire.
- Only narrowly-caught vault errors fall back in `getImportProviderFor`.
  Refresh needs no route of its own because reads already rotate.
- Notion stays on manually stored tokens until its OAuth dance gets its own
  slice; the vault, state store, and scope map are already provider-keyed
  for it.

## Verification

`oauth.test.ts`, `oauth-repository.integration.test.ts` (state lifecycle,
transparent rotation, revoked-degradation),
`pnpm verify:alpha-oauth`, `pnpm test`, `pnpm build`.
