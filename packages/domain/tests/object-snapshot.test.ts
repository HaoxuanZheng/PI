import { describe, expect, it } from "vitest";
import { createObjectInputSchema, diffSnapshots, objectSnapshotSchema, snapshotBlocks, updateObjectInputSchema } from "../src/index";

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

  it("normalizes legacy text and compares deterministic editor snapshots", () => {
    expect(snapshotBlocks(note)).toHaveLength(1);
    const changed = { ...note, title: "Changed", body: { format: "richtext" as const, content: [
      { id: "a", type: "heading" as const, text: "Heading" },
      { id: "b", type: "paragraph" as const, text: "Private context" }
    ] } };
    const diff = diffSnapshots(objectSnapshotSchema.parse(note), objectSnapshotSchema.parse(changed));
    expect(diff.title).toEqual({ before: "First note", after: "Changed" });
    expect(diff.body.map((change) => change.kind)).toEqual(["changed", "added"]);
  });
});
