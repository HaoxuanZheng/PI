# 0029 Provider Connection Vault

## Decision

Store per-user provider tokens sealed in the database and prefer them over
operator tokens, without building provider OAuth dances yet.

## Rules

- Tokens seal with AES-256-GCM under a server-only 64-hex key
  (`OAUTH_TOKEN_KEY`, `openssl rand -hex 32`), one fresh IV per token.
  Plaintext touches memory only; rows carry sealed blobs. A rotated key
  fails closed with an explicit crypto error, never garbage output.
- `POST /connections` stores or replaces one provider token plus scopes and
  TTL; `GET /connections` reports connected/expired per provider and never
  returns token material; `DELETE /connections/:provider` removes the row
  and importers fall back to operator tokens. Connect and disconnect audit
  with the provider name only.
- Importers resolve per request: a live user connection wins, absent or
  expired connections fall back explicitly, undecryptable rows fail closed
  rather than sending dead tokens. Only narrowly-caught vault errors fall
  back; anything else propagates.
- Expired means unusable everywhere: status reports it, `liveToken` refuses
  it, and the next connect replaces it. Refresh-token exchange against
  provider OAuth endpoints is future work; the vault already stores refresh
  tokens for that flow.
- The vault table is owner-isolated by RLS, and account purge severs every
  stored connection alongside vectors, since tokens are identifying
  credentials that must not outlive the account.

## Verification

`connection-repository.integration.test.ts`,
`packages/connections/tests/connections.test.ts`,
`pnpm verify:alpha-connections`, `pnpm test`, `pnpm build`.
