import { describe, expect, it } from "vitest";
import { createObjectInputSchema, objectSnapshotSchema, updateObjectInputSchema } from "../src/index";

const note = {
  schemaVersion: 1,
  type: "NOTE",
  title: "First note",
  body: { format: "plain_text", content: "Private context" },
  tags: ["foundation"],
  customFields: {}
} as const;

describe("object snapshot validation", () => {
  it("accepts a versioned note", () => {
    expect(objectSnapshotSchema.parse(note)).toMatchObject({ type: "NOTE", schemaVersion: 1 });
  });

  it("defaults every new object to private", () => {
    expect(createObjectInputSchema.parse({ snapshot: note }).visibility).toBe("PRIVATE");
  });

  it("requires optimistic concurrency for updates", () => {
    expect(updateObjectInputSchema.safeParse({ snapshot: note }).success).toBe(false);
  });

  it("rejects unsupported future snapshot versions", () => {
    expect(objectSnapshotSchema.safeParse({ ...note, schemaVersion: 2 }).success).toBe(false);
  });
});
