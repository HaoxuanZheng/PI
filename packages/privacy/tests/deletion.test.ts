import { describe, expect, it } from "vitest";
import {
  assertBundleOwnership,
  deletionGraceDays,
  emptyCollections,
  exportBundleVersion,
  exportCollections,
  purgeAfter,
  renderMarkdownExport,
  requestDeletionInputSchema,
  requestExportInputSchema,
  type ExportBundle
} from "../src/index.js";

describe("deletion window", () => {
  it("purges 7 days after the request", () => {
    const requestedAt = new Date("2026-09-23T00:00:00.000Z");
    expect(purgeAfter(requestedAt).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(deletionGraceDays).toBe(7);
  });

  it("requires explicit typed confirmation", () => {
    expect(() => requestDeletionInputSchema.parse({ confirm: true, acknowledgement: "DELETE MY ACCOUNT" })).not.toThrow();
    expect(() => requestDeletionInputSchema.parse({ confirm: true, acknowledgement: "delete" })).toThrow();
    expect(() => requestDeletionInputSchema.parse({ confirm: false, acknowledgement: "DELETE MY ACCOUNT" })).toThrow();
  });

  it("defaults export format without accepting unknown formats", () => {
    expect(requestExportInputSchema.parse({}).format).toBe("JSON");
    expect(() => requestExportInputSchema.parse({ format: "CSV" })).toThrow();
  });
});

describe("export ownership guard", () => {
  function bundleWith(ownerId: string, otherId: string): ExportBundle {
    const collections = emptyCollections();
    collections.objects = [{ id: "obj-1", ownerId }];
    collections.revisions = [{ objectId: "obj-1" }];
    collections.grantsIssued = [{ ownerId: otherId }];
    return {
      bundleVersion: exportBundleVersion,
      exportedAt: new Date().toISOString(),
      user: {
        id: ownerId,
        username: "user",
        displayName: null,
        email: null,
        timezone: "UTC",
        locale: "en-US",
        accountStatus: "ACTIVE",
        createdAt: new Date().toISOString()
      },
      collections
    };
  }

  it("rejects a bundle carrying another user's record", () => {
    expect(() => assertBundleOwnership(bundleWith("user-1", "user-2"), "user-1")).toThrow(/another user/);
  });

  it("accepts a bundle owned entirely by the requester", () => {
    const bundle = bundleWith("user-1", "user-1");
    expect(assertBundleOwnership(bundle, "user-1").bundleVersion).toBe(exportBundleVersion);
    expect(exportCollections).toContain("objects");
    expect(renderMarkdownExport(bundle)).toContain("LifeGraph export");
  });
});
