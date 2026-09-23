import { z } from "zod";

export class AnalyticsValidationError extends Error {
  readonly code = "VALIDATION_FAILED";
}

/**
 * Product analytics events. Explicit allowlist so a new event is a deliberate
 * product decision, not an accidental log line. Mirrors the specification's
 * section 47 plus the onboarding lifecycle.
 */
export const analyticsEventSchema = z.enum([
  "account_created",
  "onboarding_started",
  "onboarding_goal_selected",
  "onboarding_completed",
  "import_connected",
  "import_completed",
  "object_created",
  "inline_ai_opened",
  "inline_ai_proposed",
  "inline_ai_accepted",
  "inline_ai_rejected",
  "ask_my_life_submitted",
  "ask_my_life_source_opened",
  "publication_previewed",
  "publication_created",
  "profile_shared_qr",
  "connection_created"
]);

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;

export const onboardingGoalSchema = z.enum([
  "organize",
  "living-profile",
  "remember-people",
  "explore-history"
]);

export type OnboardingGoal = z.infer<typeof onboardingGoalSchema>;

export const onboardingGoals: Array<{ value: OnboardingGoal; label: string }> = [
  { value: "organize", label: "Organize my information" },
  { value: "living-profile", label: "Build my living profile" },
  { value: "remember-people", label: "Remember people" },
  { value: "explore-history", label: "Explore my history" }
];

/** Activation target from the specification: 10 meaningful objects. */
export const activationObjectThreshold = 10;

const metadataValueSchema = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

export const analyticsMetadataSchema = z.record(z.string().max(80), metadataValueSchema);

export type AnalyticsMetadata = z.infer<typeof analyticsMetadataSchema>;

/**
 * Keys that must never appear in analytics metadata. Analytics carries
 * counts, ids, and decisions — never bodies, transcripts, or contact detail.
 * The check is substring-based so `noteBody` and `emailAddress` fail too.
 */
const forbiddenMetadataSubstrings = [
  "body",
  "text",
  "transcript",
  "content",
  "snapshot",
  "file",
  "email",
  "phone",
  "address"
];

export function assertSafeMetadata(metadata: Record<string, unknown>) {
  for (const key of Object.keys(metadata)) {
    const lowered = key.toLowerCase();
    if (forbiddenMetadataSubstrings.some((part) => lowered.includes(part))) {
      throw new AnalyticsValidationError(`Analytics metadata must not contain "${key}"`);
    }
    const value = metadata[key];
    if (typeof value === "string" && value.length > 200) {
      throw new AnalyticsValidationError(`Analytics metadata value for "${key}" is too long`);
    }
  }
  return metadata as AnalyticsMetadata;
}

export const recordAnalyticsEventInputSchema = z.object({
  event: analyticsEventSchema,
  metadata: analyticsMetadataSchema.default({})
}).superRefine((value, context) => {
  try {
    assertSafeMetadata(value.metadata);
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["metadata"],
      message: error instanceof Error ? error.message : "Unsafe analytics metadata"
    });
  }
});

export type RecordAnalyticsEventInput = z.infer<typeof recordAnalyticsEventInputSchema>;

export const updateOnboardingInputSchema = z.object({
  action: z.enum(["start", "select-goal", "complete"]),
  goal: onboardingGoalSchema.optional()
}).superRefine((value, context) => {
  if (value.action === "select-goal" && !value.goal) {
    context.addIssue({ code: "custom", path: ["goal"], message: "A goal is required" });
  }
});

export type UpdateOnboardingInput = z.infer<typeof updateOnboardingInputSchema>;

export type OnboardingStatus = {
  started: boolean;
  goal: OnboardingGoal | null;
  completed: boolean;
  startedAt: string | null;
  completedAt: string | null;
  objectCount: number;
  activated: boolean;
};
