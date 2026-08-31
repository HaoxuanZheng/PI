# Publications runbook

Living Identity: `@username` profiles, a Professional View, public object pages, and QR/NFC sharing.
This is the only public read path in the system, and it serves authorized projections — never
canonical objects.

## Public routes

| Route | Serves |
| --- | --- |
| `/@username` | Published `PROFILE` projection, plus links to public object pages |
| `/@username/professional` | Published `PROFESSIONAL` projection |
| `/@username/p/{slug}` | Published `OBJECT` projection |

All three are server-rendered, require no session, and read only from `publications`. A handle
without an `@` prefix, an unknown handle, or an unpublished page is a 404.

## What can be published

Only these snapshot fields may ever appear publicly:

| Field | Notes |
| --- | --- |
| `title` | |
| `summary` | |
| `body` | Flattened to plain text; block identifiers are not exposed |
| `tags` | |

`customFields` is **never** publishable — it carries person emails, phone numbers, and importer
metadata. Naming `customFields`, `person`, `source`, or `schemaVersion` is a `400`, not a silent
omission. A `PERSON` object cannot be published at all.

## API contract

### `POST /api/v1/publications/preview`

Returns exactly what publishing would store, without persisting anything. Use this to show the user
precisely what outsiders would see.

Object preview:

```json
{ "sourceObjectId": "uuid", "fields": ["title", "summary"] }
```

Profile preview: the same body as publish, minus `confirm`.

### `POST /api/v1/publications`

Object page — requires `SHARE`, explicit confirmation, and the expected current revision:

```json
{ "sourceObjectId": "uuid", "slug": "my-project", "fields": ["title", "summary", "body", "tags"],
  "expectedRevisionId": "uuid", "confirm": true }
```

Profile or professional view — a view configuration over your own objects:

```json
{ "publicationType": "PROFESSIONAL", "displayName": "Haoxuan", "headline": "Building…",
  "sections": [{ "type": "EXPERIENCE", "heading": "Experience",
                 "sourceObjectIds": ["uuid"], "fields": ["title", "summary"] }],
  "confirm": true }
```

`409 PUBLICATION_STATE_CONFLICT` if the object changed after the preview — re-preview and confirm
again. Publishing the same slug again replaces that publication.

### `GET /api/v1/publications`

Your publications plus a `stale` list: publications whose source has been edited since publishing.

### `DELETE /api/v1/publications/:publicationId`

Unpublishes immediately. The public route becomes a 404 on the next request.

## Sharing

`profileShareUrl(appUrl, username)` and `objectShareUrl(appUrl, username, slug)` produce the canonical
payload for a QR code or NFC tag — a plain HTTPS URL, so a recipient needs no app. No QR encoder is
bundled; rendering the image is a client concern.

## Verification

```bash
pnpm verify:living-identity   # allowlist, migration, and public-path invariants
pnpm test                     # projection tests always run
```

The gate is partly a static security check. It fails the build if the public read path mentions
`setOwnerContext`, `objectRevisions`, `from(objects)`, or `users.`, or if a public page imports an
authenticated repository. Keep it that way.

Database-backed coverage requires a disposable database:

```bash
TEST_DATABASE_URL=postgresql://... pnpm test
```

`packages/db/tests/publication-repository.integration.test.ts` asserts that no public response
contains private detail, owner email, or owner id; that a stale revision is refused; that a `PERSON`
cannot be published; that a profile cannot reference another user's object; that editing a source
does not change what is public but is reported stale; that unpublish is immediate; and that deleting
a source object stops serving it.

## Operational notes

- **A publication is frozen, not live.** Editing the source does not change the public page. Watch
  the `stale` list and re-publish deliberately.
- **Deleting an object unpublishes it** through the `objects_unpublish_on_delete` trigger, so a
  deleted record cannot remain readable through its frozen projection.
- **Changing a username** does not rewrite existing publications, because the handle is denormalised
  onto each row. Username changes are not implemented; if they are added, publications must be
  re-handled at the same time.
- **Legal review is still outstanding.** The specification requires legal and compliance review
  before public launch. This milestone makes publication technically possible; it does not discharge
  that review.
- **Audit.** `OBJECT_PUBLISHED`, `PROFILE_PUBLISHED`, and `PUBLICATION_UNPUBLISHED` record ids, slug,
  and selected field names only — never published or private content.
