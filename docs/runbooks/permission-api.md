# Permission API

The Permission Engine is owner-managed in V0.3. Every endpoint requires an authenticated session. Unauthorized and unknown object IDs both return `NOT_FOUND` to reduce object enumeration.

## Capability implications

| Grant | Effective capabilities |
| --- | --- |
| READ | READ |
| COMMENT | READ, COMMENT |
| EDIT | READ, EDIT |
| COLLABORATE | READ, COMMENT, EDIT, COLLABORATE |
| SHARE | READ, SHARE |
| ADMIN | READ, COMMENT, EDIT, COLLABORATE, SHARE, ADMIN |

ADMIN does not delegate grant management in this version; only the canonical owner can grant or revoke.

## List grants

`GET /api/v1/objects/:objectId/permissions`

## Grant a user

`POST /api/v1/objects/:objectId/permissions`

```json
{
  "principalType": "USER",
  "principalId": "00000000-0000-4000-8000-000000000001",
  "capability": "READ"
}
```

Only USER UUID principals are accepted by the current API. The database model reserves CONNECTION, GROUP, LINK, PUBLIC, and SYSTEM_AI for later identity-aware implementations. A PUBLIC permission never exposes an OBJECT; public pages must read a filtered publication projection.

Identical active grants are idempotent and return the existing record.

## Revoke

`DELETE /api/v1/objects/:objectId/permissions/:permissionId`

Revocation sets `revoked_at`; it does not erase grant history. Grant and revoke actions create audit records containing IDs, principal type, and capability—never private object content.
