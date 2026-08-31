import { describe, expect, it } from "vitest";
import {
  ImportValidationError,
  applyAction,
  decideImportAction,
  dedupeBatch,
  emptyCounters,
  hashImportContent,
  normalizedImportItemSchema
} from "../src/index";
import { createGoogleDriveProvider, driveObjectType, normalizeDriveFile, type DriveTransport } from "../src/google-drive";
import { createGoogleContactsProvider, normalizeContact, type ContactsTransport } from "../src/google-contacts";
import { createNotionProvider, normalizeNotionPage, notionApiVersion, notionPropertyValue, type NotionTransport } from "../src/notion";

const driveDoc = {
  id: "drive-1",
  name: "Roadmap",
  mimeType: "application/vnd.google-apps.document",
  modifiedTime: "2026-08-01T10:00:00.000Z",
  webViewLink: "https://docs.google.com/document/d/drive-1"
};

describe("content hashing", () => {
  it("is stable regardless of key order", () => {
    expect(hashImportContent({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(hashImportContent({ b: [2, { d: 4, c: 3 }], a: 1 }));
  });

  it("changes when content changes", () => {
    expect(hashImportContent({ body: "one" })).not.toBe(hashImportContent({ body: "two" }));
  });
});

describe("idempotency decision", () => {
  it("creates when nothing exists", () => {
    expect(decideImportAction(null, { contentHash: "a" })).toBe("CREATE");
  });

  it("skips an unchanged source", () => {
    expect(decideImportAction({ objectId: "o1", contentHash: "a" }, { contentHash: "a" })).toBe("SKIP");
  });

  it("updates a changed source", () => {
    expect(decideImportAction({ objectId: "o1", contentHash: "a" }, { contentHash: "b" })).toBe("UPDATE");
  });

  it("updates when a prior import recorded no hash", () => {
    expect(decideImportAction({ objectId: "o1", contentHash: null }, { contentHash: "a" })).toBe("UPDATE");
  });

  it("tallies counters per action", () => {
    let counters = emptyCounters();
    for (const action of ["CREATE", "SKIP", "UPDATE", "ERROR"] as const) counters = applyAction(counters, action);
    expect(counters).toEqual({ imported: 2, skipped: 1, errors: 1 });
  });
});

describe("batch dedupe", () => {
  it("drops repeated external ids within one batch", () => {
    const item = normalizeDriveFile(driveDoc, { body: "alpha" });
    const result = dedupeBatch([item, item, { ...item, sourceExternalId: "drive-2" }]);
    expect(result.unique).toHaveLength(2);
    expect(result.duplicates).toBe(1);
  });
});

describe("drive normalisation", () => {
  it("maps a Google Doc to a NOTE with preserved source metadata", () => {
    const item = normalizeDriveFile(driveDoc, { body: "alpha", folderPath: "/Work" });
    expect(item.snapshot.type).toBe("NOTE");
    expect(item.snapshot.title).toBe("Roadmap");
    expect(item.snapshot.body).toEqual({ format: "plain_text", content: "alpha" });
    expect(item.snapshot.customFields).toMatchObject({ source: { provider: "GOOGLE_DRIVE", externalId: "drive-1", folderPath: "/Work" } });
    expect(item.sourceModifiedAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("never marks imported content public", () => {
    const item = normalizeDriveFile(driveDoc, { body: "alpha" });
    expect(JSON.stringify(item)).not.toContain("PUBLIC");
    expect(normalizedImportItemSchema.parse(item)).toEqual(item);
  });

  it("produces a metadata-only record for a PDF", () => {
    const item = normalizeDriveFile({ ...driveDoc, id: "drive-pdf", mimeType: "application/pdf", name: "Contract.pdf" });
    expect(item.snapshot.type).toBe("FILE");
    expect(item.snapshot.body).toBeUndefined();
  });

  it("is deterministic for the same input and sensitive to a body edit", () => {
    const first = normalizeDriveFile(driveDoc, { body: "alpha" });
    expect(normalizeDriveFile(driveDoc, { body: "alpha" }).contentHash).toBe(first.contentHash);
    expect(normalizeDriveFile(driveDoc, { body: "beta" }).contentHash).not.toBe(first.contentHash);
  });

  it("maps types by mime family", () => {
    expect(driveObjectType("image/png")).toBe("PHOTO");
    expect(driveObjectType("audio/webm")).toBe("VOICE_NOTE");
    expect(driveObjectType("application/pdf")).toBe("FILE");
    expect(driveObjectType("text/markdown")).toBe("NOTE");
  });

  it("rejects an unparseable modified time", () => {
    expect(() => normalizeDriveFile({ ...driveDoc, modifiedTime: "not-a-date" })).toThrow(ImportValidationError);
  });
});

describe("drive provider", () => {
  const transportFor = (pages: Record<string, string>): { calls: string[]; transport: DriveTransport } => {
    const calls: string[] = [];
    return {
      calls,
      transport: async (url) => {
        calls.push(url);
        const match = Object.keys(pages).find((key) => url.includes(key));
        if (!match) return { ok: false, status: 404, text: async () => "missing" };
        return { ok: true, status: 200, text: async () => pages[match] as string };
      }
    };
  };

  it("requires an access token", () => {
    expect(() => createGoogleDriveProvider({ accessToken: "  " })).toThrow(ImportValidationError);
  });

  it("lists a page, exports doc text, and returns the next cursor", async () => {
    const { calls, transport } = transportFor({
      "files?q=": JSON.stringify({ files: [driveDoc], nextPageToken: "page-2" }),
      "/export?mimeType=text/plain": "exported body"
    });
    const provider = createGoogleDriveProvider({ accessToken: "token", transport });
    const batch = await provider.fetchBatch();
    expect(batch.nextCursor).toBe("page-2");
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]?.snapshot.body).toEqual({ format: "plain_text", content: "exported body" });
    expect(calls.some((url) => url.includes("trashed%3Dfalse"))).toBe(true);
  });

  it("skips trashed files and does not fetch a body for a PDF", async () => {
    const { calls, transport } = transportFor({
      "files?q=": JSON.stringify({
        files: [{ ...driveDoc, trashed: true }, { ...driveDoc, id: "drive-pdf", mimeType: "application/pdf" }]
      })
    });
    const batch = await createGoogleDriveProvider({ accessToken: "token", transport }).fetchBatch();
    expect(batch.items.map((item) => item.sourceExternalId)).toEqual(["drive-pdf"]);
    expect(batch.nextCursor).toBeNull();
    expect(calls.some((url) => url.includes("alt=media") || url.includes("/export"))).toBe(false);
  });

  it("surfaces a provider failure rather than importing nothing silently", async () => {
    const { transport } = transportFor({});
    await expect(createGoogleDriveProvider({ accessToken: "token", transport }).fetchBatch()).rejects.toThrow(/status 404/);
  });
});

describe("contacts normalisation", () => {
  const contact = {
    resourceName: "people/c1",
    names: [{ displayName: "Alex Chen" }],
    emailAddresses: [{ value: " Alex@Example.com " }],
    phoneNumbers: [{ value: "+1 212 555 0147" }],
    organizations: [{ name: "Example Labs", title: "Engineer" }]
  };

  it("maps a contact to a PERSON with typed profile detail", () => {
    const item = normalizeContact(contact);
    expect(item.snapshot.type).toBe("PERSON");
    expect(item.snapshot.title).toBe("Alex Chen");
    expect(item.snapshot.customFields).toMatchObject({
      person: { displayName: "Alex Chen", organization: "Example Labs", role: "Engineer", emails: ["Alex@Example.com"], phones: ["+1 212 555 0147"] },
      source: { provider: "GOOGLE_CONTACTS", externalId: "people/c1" }
    });
  });

  it("falls back to an email when the contact has no name", () => {
    const item = normalizeContact({ resourceName: "people/c2", emailAddresses: [{ value: "solo@example.com" }] });
    expect(item.snapshot.title).toBe("solo@example.com");
  });

  it("rejects a contact that cannot be identified at all", () => {
    expect(() => normalizeContact({ resourceName: "people/c3", phoneNumbers: [{ value: "212-555-0147" }] })).toThrow(ImportValidationError);
  });

  it("hashes only profile content, so a re-import of the same contact is unchanged", () => {
    expect(normalizeContact(contact).contentHash).toBe(normalizeContact({ ...contact }).contentHash);
    expect(normalizeContact({ ...contact, organizations: [{ name: "Other Co", title: "Engineer" }] }).contentHash)
      .not.toBe(normalizeContact(contact).contentHash);
  });

  it("skips unidentifiable contacts instead of failing the page", async () => {
    const payload = JSON.stringify({ connections: [contact, { resourceName: "people/bad" }], nextPageToken: null });
    const transport: ContactsTransport = async () => ({ ok: true, status: 200, text: async () => payload });
    const batch = await createGoogleContactsProvider({ accessToken: "token", transport }).fetchBatch();
    expect(batch.items.map((item) => item.sourceExternalId)).toEqual(["people/c1"]);
  });

  it("requires an access token", () => {
    expect(() => createGoogleContactsProvider({ accessToken: " " })).toThrow(ImportValidationError);
  });
});

describe("notion normalisation", () => {
  const page = {
    id: "notion-1",
    url: "https://notion.so/notion-1",
    last_edited_time: "2026-08-02T09:00:00.000Z",
    parent: { type: "page_id", page_id: "parent-1" },
    properties: {
      Name: { type: "title", title: [{ plain_text: "Launch plan" }] },
      Stage: { type: "select", select: { name: "Active" } },
      Tags: { type: "multi_select", multi_select: [{ name: "AI" }, { name: "MVP" }] },
      Done: { type: "checkbox", checkbox: false },
      Notes: { type: "rich_text", rich_text: [{ plain_text: "context" }] }
    }
  };

  const contactPage = {
    id: "notion-2",
    parent: { type: "database_id", database_id: "db-1" },
    properties: {
      Name: { type: "title", title: [{ plain_text: "Riya Shah" }] },
      Email: { type: "email", email: "riya@example.com" },
      Phone: { type: "phone_number", phone_number: "+1 415 555 0100" },
      Company: { type: "select", select: { name: "Example Labs" } }
    }
  };

  it("maps a page to a NOTE and preserves properties as source metadata", () => {
    const item = normalizeNotionPage(page, { body: "line one" });
    expect(item.snapshot.type).toBe("NOTE");
    expect(item.snapshot.title).toBe("Launch plan");
    expect(item.snapshot.body).toEqual({ format: "plain_text", content: "line one" });
    expect(item.snapshot.customFields).toMatchObject({
      source: {
        provider: "NOTION",
        externalId: "notion-1",
        parentType: "page_id",
        properties: { Stage: "Active", Tags: ["AI", "MVP"], Done: false, Notes: "context" }
      }
    });
    expect(item.sourceModifiedAt).toBe("2026-08-02T09:00:00.000Z");
  });

  it("flattens each supported property type and records unsupported ones as absent", () => {
    expect(notionPropertyValue({ type: "number", number: 7 })).toBe(7);
    expect(notionPropertyValue({ type: "date", date: { start: "2026-08-02" } })).toBe("2026-08-02");
    expect(notionPropertyValue({ type: "url", url: "https://example.com" })).toBe("https://example.com");
    expect(notionPropertyValue({ type: "relation" })).toBeNull();
  });

  it("maps a database page with an email to a PERSON usable by entity resolution", () => {
    const item = normalizeNotionPage(contactPage);
    expect(item.snapshot.type).toBe("PERSON");
    expect(item.snapshot.customFields).toMatchObject({
      person: { displayName: "Riya Shah", emails: ["riya@example.com"], phones: ["+1 415 555 0100"], organization: "Example Labs" }
    });
  });

  it("keeps a database page without an email as a NOTE", () => {
    const item = normalizeNotionPage({ ...contactPage, properties: { Name: contactPage.properties.Name } });
    expect(item.snapshot.type).toBe("NOTE");
    expect(item.snapshot.customFields).not.toHaveProperty("person");
  });

  it("does not treat a page outside a database as a PERSON even with an email", () => {
    const item = normalizeNotionPage({ ...contactPage, parent: { type: "page_id", page_id: "p1" } });
    expect(item.snapshot.type).toBe("NOTE");
  });

  it("rejects a page with neither title nor body", () => {
    expect(() => normalizeNotionPage({ id: "notion-3", properties: {} })).toThrow(ImportValidationError);
  });

  it("imports an untitled page that still has body content", () => {
    const item = normalizeNotionPage({ id: "notion-4", properties: {} }, { body: "orphan text" });
    expect(item.snapshot.title).toBe("Untitled Notion page");
  });

  it("changes its hash when a property changes but not on a replay", () => {
    const first = normalizeNotionPage(page, { body: "line one" });
    expect(normalizeNotionPage(page, { body: "line one" }).contentHash).toBe(first.contentHash);
    expect(normalizeNotionPage({ ...page, properties: { ...page.properties, Done: { type: "checkbox", checkbox: true } } }, { body: "line one" }).contentHash)
      .not.toBe(first.contentHash);
  });

  it("reads blocks, skips archived pages, and pins the API version", async () => {
    const calls: string[] = [];
    const transport: NotionTransport = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      expect(init.headers["notion-version"]).toBe(notionApiVersion);
      if (url.endsWith("/search")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ results: [page, { ...page, id: "gone", archived: true }], has_more: false, next_cursor: null }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: [
        { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Heading" }] } },
        { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Body text" }] } },
        { type: "image", image: {} }
      ], next_cursor: null }) };
    };
    const batch = await createNotionProvider({ apiToken: "secret", transport }).fetchBatch();
    expect(batch.items.map((item) => item.sourceExternalId)).toEqual(["notion-1"]);
    expect(batch.items[0]?.snapshot.body).toEqual({ format: "plain_text", content: "Heading\nBody text" });
    expect(batch.nextCursor).toBeNull();
    expect(calls[0]).toBe("POST https://api.notion.com/v1/search");
  });

  it("stops paging when Notion reports no more results", async () => {
    const transport: NotionTransport = async (url) => ({
      ok: true,
      status: 200,
      text: async () => url.endsWith("/search")
        ? JSON.stringify({ results: [], has_more: true, next_cursor: "cursor-2" })
        : JSON.stringify({ results: [], next_cursor: null })
    });
    const batch = await createNotionProvider({ apiToken: "secret", transport }).fetchBatch();
    expect(batch.nextCursor).toBe("cursor-2");
  });

  it("requires an API token and surfaces provider failures", async () => {
    expect(() => createNotionProvider({ apiToken: "  " })).toThrow(ImportValidationError);
    const transport: NotionTransport = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
    await expect(createNotionProvider({ apiToken: "secret", transport }).fetchBatch()).rejects.toThrow(/status 429/);
  });
});
