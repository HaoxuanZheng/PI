# Foundation Threat Model

## Assets

- authentication sessions and provider credentials
- server-only database connection strings
- future authoritative Personal Graph data
- future derived search, embedding, and AI context data

## Trust boundaries

- Browser input is untrusted.
- Authentication assertions are verified by the server-side provider adapter.
- PostgreSQL is authoritative; indexes and caches are derived.
- Third-party AI, import, and storage providers will be isolated behind explicit adapters.

## Foundation controls

- Strict input and environment validation
- Server-only secrets and provider-neutral auth contract
- Secure HTTP-only session cookies managed by the auth provider
- Generic authentication errors that do not disclose sensitive provider detail
- No raw private content in health output or general logs
- Dependency and static checks in CI

## Remaining security work

Object ownership now uses application filters plus forced PostgreSQL RLS, with negative cross-user integration coverage. Explicit capability grants, audit events, rate limiting, upload validation, and deletion propagation belong to their respective vertical slices. Public projection endpoints remain forbidden until field-level authorization tests exist.
