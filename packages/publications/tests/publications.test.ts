import type { ObjectSnapshot } from "@lifegraph/domain";
import { describe, expect, it } from "vitest";
import {
  PublicationValidationError,
  objectShareUrl,
  parseProfileHandle,
  profileShareUrl,
  projectObjectSnapshot,
  projectProfile,
  publicObjectFields,
  publishObjectInputSchema
} from "../src/index";

/** A snapshot carrying exactly the kind of private detail that must never be projected. */
const privateSnapshot: ObjectSnapshot = {
  schemaVersion: 1,
  type: "PERSON",
  title: "Alex Chen",
  summary: "Met at the NYC AI meetup",
  body: { format: "richtext", content: [
    { id: "b1", type: "heading", text: "Background" },
    { id: "b2", type: "paragraph", text: "Works on education AI" }
  ] },
  tags: ["ai", "education"],
  customFields: {
    person: { displayName: "Alex Chen", emails: ["alex@example.com"], phones: ["+1 212 555 0147"], organization: "Example Labs", role: null, interests: [] },
    source: { provider: "GOOGLE_CONTACTS", externalId: "people/c1" },
    privateNotes: "Asked me not to share his number"
  }
};

describe("public projection", () => {
  it("includes only the requested allowlisted fields", () => {
    expect(projectObjectSnapshot(privateSnapshot, ["title", "summary"])).toEqual({
      type: "PERSON",
      title: "Alex Chen",
      summary: "Met at the NYC AI meetup",
      body: null,
      tags: []
    });
  });

  it("never leaks customFields, contact detail, or provider metadata", () => {
    const projection = projectObjectSnapshot(privateSnapshot, [...publicObjectFields]);
    const serialised = JSON.stringify(projection);
    for (const secret of ["alex@example.com", "555-0147", "555 0147", "GOOGLE_CONTACTS", "people/c1", "privateNotes", "Asked me not to share"]) {
      expect(serialised).not.toContain(secret);
    }
    expect(Object.keys(projection).sort()).toEqual(["body", "summary", "tags", "title", "type"]);
    expect(projection).not.toHaveProperty("customFields");
  });

  it("refuses to project a forbidden field even when named explicitly", () => {
    for (const field of ["customFields", "person", "source", "schemaVersion"]) {
      expect(() => projectObjectSnapshot(privateSnapshot, ["title", field])).toThrow(PublicationValidationError);
    }
  });

  it("rejects an unknown field rather than silently dropping it", () => {
    expect(() => projectObjectSnapshot(privateSnapshot, ["title", "observedAt"])).toThrow(/not a publishable field/);
  });

  it("requires at least one field", () => {
    expect(() => projectObjectSnapshot(privateSnapshot, [])).toThrow(PublicationValidationError);
  });

  it("flattens body blocks so block identifiers are not exposed", () => {
    const projection = projectObjectSnapshot(privateSnapshot, ["body"]);
    expect(projection.body).toBe("Background\nWorks on education AI");
    expect(JSON.stringify(projection)).not.toContain("b1");
  });

  it("returns null body when the snapshot has none", () => {
    const withoutBody = { ...privateSnapshot };
    delete (withoutBody as Partial<ObjectSnapshot>).body;
    expect(projectObjectSnapshot(withoutBody, ["body"]).body).toBeNull();
  });

  it("copies tags rather than sharing the private array", () => {
    const projection = projectObjectSnapshot(privateSnapshot, ["tags"]);
    projection.tags.push("mutated");
    expect(privateSnapshot.tags).toEqual(["ai", "education"]);
  });
});

describe("publish input", () => {
  const valid = {
    sourceObjectId: "11111111-1111-4111-8111-111111111111",
    slug: "my-project",
    fields: ["title", "summary"],
    expectedRevisionId: "22222222-2222-4222-8222-222222222222",
    confirm: true
  };

  it("accepts a confirmed publication", () => {
    expect(publishObjectInputSchema.parse(valid).confirm).toBe(true);
  });

  it("cannot be published without explicit confirmation", () => {
    expect(publishObjectInputSchema.safeParse({ ...valid, confirm: false }).success).toBe(false);
    const unconfirmed: Record<string, unknown> = { ...valid };
    delete unconfirmed["confirm"];
    expect(publishObjectInputSchema.safeParse(unconfirmed).success).toBe(false);
  });

  it("requires a well-formed slug", () => {
    for (const slug of ["A", "-leading", "has space", "x".repeat(90), "under_score", "slash/es"]) {
      expect(publishObjectInputSchema.safeParse({ ...valid, slug }).success).toBe(false);
    }
  });

  it("normalises case and surrounding whitespace, matching the username contract", () => {
    expect(publishObjectInputSchema.parse({ ...valid, slug: " My-Project " }).slug).toBe("my-project");
    expect(publishObjectInputSchema.parse({ ...valid, slug: "Upper-Case" }).slug).toBe("upper-case");
  });
});

describe("profile projection", () => {
  it("projects each section through the same allowlist", () => {
    const profile = projectProfile({
      username: "haoxuan",
      displayName: "Haoxuan",
      headline: "Building a Personal Internet",
      sections: [{ type: "PROJECT", heading: "Projects", fields: ["title", "summary"], snapshots: [privateSnapshot] }]
    });
    expect(profile.sections[0]?.items[0]).toEqual({
      type: "PERSON",
      title: "Alex Chen",
      summary: "Met at the NYC AI meetup",
      body: null,
      tags: []
    });
    expect(JSON.stringify(profile)).not.toContain("alex@example.com");
  });

  it("validates the username it publishes under", () => {
    expect(() => projectProfile({ username: "Not A Username", displayName: "x", headline: null, sections: [] })).toThrow();
  });
});

describe("share urls and handles", () => {
  it("builds canonical profile and object urls", () => {
    expect(profileShareUrl("https://example.com/", "haoxuan")).toBe("https://example.com/@haoxuan");
    expect(objectShareUrl("https://example.com", "haoxuan", "my-project")).toBe("https://example.com/@haoxuan/p/my-project");
  });

  it("parses a profile handle and rejects anything else", () => {
    expect(parseProfileHandle("@haoxuan")).toBe("haoxuan");
    expect(parseProfileHandle("haoxuan")).toBeNull();
    expect(parseProfileHandle("@Not Valid")).toBeNull();
    expect(parseProfileHandle("@")).toBeNull();
    expect(parseProfileHandle("library")).toBeNull();
  });
});
