import { describe, expect, it } from "vitest";
import {
  activationObjectThreshold,
  assertSafeMetadata,
  onboardingGoals,
  recordAnalyticsEventInputSchema,
  updateOnboardingInputSchema
} from "../src/index.js";

describe("analytics metadata guard", () => {
  it("accepts counts and ids", () => {
    expect(() => assertSafeMetadata({ objectCount: 3, provider: "NOTION" })).not.toThrow();
    expect(recordAnalyticsEventInputSchema.parse({ event: "object_created", metadata: { objectCount: 1 } }).event).toBe(
      "object_created"
    );
  });

  it("rejects bodies, transcripts, and contact detail", () => {
    for (const key of ["body", "noteText", "transcript", "snapshot", "emailAddress", "phoneNumber", "fileKey"]) {
      expect(() => assertSafeMetadata({ [key]: "x" })).toThrow();
    }
    expect(() => recordAnalyticsEventInputSchema.parse({ event: "object_created", metadata: { body: "hi" } })).toThrow();
  });

  it("rejects unknown events", () => {
    expect(() => recordAnalyticsEventInputSchema.parse({ event: "note_viewed", metadata: {} })).toThrow();
  });
});

describe("onboarding", () => {
  it("exposes the four specification goals with a 10-object activation target", () => {
    expect(onboardingGoals.map((goal) => goal.value).sort()).toEqual(
      ["explore-history", "living-profile", "organize", "remember-people"].sort()
    );
    expect(activationObjectThreshold).toBe(10);
  });

  it("requires a goal for select-goal", () => {
    expect(() => updateOnboardingInputSchema.parse({ action: "select-goal", goal: "organize" })).not.toThrow();
    expect(() => updateOnboardingInputSchema.parse({ action: "select-goal" })).toThrow();
    expect(() => updateOnboardingInputSchema.parse({ action: "start" })).not.toThrow();
  });
});
