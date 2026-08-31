# 0018 — Notion page mapping

Status: accepted (V0.13)

## Context

Notion is the second prioritised importer (specification §4.1, §25). The import framework from V0.11
already provides the provider contract, idempotency, cursors, and per-record error tolerance, so
this milestone adds no new architecture. What it does need is a set of mapping decisions, because
Notion's model is looser than Drive's: a "page" may be a free-form document or a row in a database
with arbitrary user-defined properties.

The specification asks for page → NOTE or generic document object, database page → "typed object
where confidently mapped", properties → metadata, and parent/database info → source metadata.

## Decision

**Default to NOTE.** A Notion page becomes a `NOTE` unless there is positive evidence for something
more specific. Guessing a type from a page's shape would produce objects the user did not ask for and
cannot easily correct.

**A database page becomes a PERSON only with a title and a populated email property.** This is the
narrow reading of "confidently mapped". An email is the signal that both justifies the type and makes
the record immediately useful: it feeds the deterministic `EMAIL` signal in entity resolution
(`0017`), so a Notion CRM row and a Google contact for the same human surface as a duplicate
proposal rather than two silent copies. A page outside a database is never a `PERSON`, even with an
email property, because a standalone page with a contact field is more likely a document about
someone than a record of them.

**Properties are flattened to comparable scalars.** `notionPropertyValue` maps each supported
property type to a string, number, boolean, or string array, and records unsupported types as absent
rather than guessing. Flattened properties are part of the content hash, so a property edit in Notion
correctly re-imports as an `UPDATE` while a no-op sync stays a `SKIP`.

**Raw parent, database, and property metadata is preserved** under `customFields.source`, including
the page URL and database id, for future migration debugging. None of it is mapped into a field a
public projection reads.

**The API version is pinned** to `2022-06-28`, so a Notion API change cannot silently alter mapped
content or hashes.

**An unidentifiable page is skipped, not fatal.** A page with neither a title nor body content is
rejected by normalisation, and the provider skips it rather than failing the batch — consistent with
the Contacts adapter. A page with body content but no title imports as "Untitled Notion page", since
the content is still recognisable to its owner.

## Consequences

- Only top-level textual blocks are read. Nested block trees, tables, embeds, and databases-as-blocks
  are not represented in the body, so an imported page can be less complete than it appears in
  Notion. Block reading is capped at four pages of 100 blocks per document.
- Because bodies come from a second request per page, importing N pages costs N+1 or more API calls.
  With no background worker (`0016`), a large workspace needs many `continue` calls and may meet
  Notion's rate limits; a provider failure fails the run but preserves the cursor, so it resumes.
- The `PERSON` heuristic will miss contact databases that store email in an unsupported property
  type, and will classify a non-person database row that happens to carry an email. Both are
  correctable by the user, and neither can silently merge anything: entity resolution still proposes.
- Notion attachments and file properties are not imported; imported binaries remain out of scope
  until imports flow through the capture path (`0016`).
