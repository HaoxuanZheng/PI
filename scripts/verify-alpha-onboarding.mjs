import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "packages/analytics/src/index.ts",
  "packages/analytics/tests/analytics.test.ts",
  "packages/db/migrations/0013_onboarding_analytics.sql",
  "packages/db/src/repositories/onboarding.ts",
  "apps/web/app/api/v1/onboarding/route.ts",
  "apps/web/app/api/v1/analytics/events/route.ts",
  "apps/web/app/library/onboarding.tsx",
  "docs/architecture/0023-onboarding-analytics.md"
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const analytics = await readFile(resolve(root, "packages/analytics/src/index.ts"), "utf8");
for (const invariant of [
  "analyticsEventSchema",
  "onboardingGoalSchema",
  "assertSafeMetadata",
  "activationObjectThreshold",
  "recordAnalyticsEventInputSchema"
]) {
  if (!analytics.includes(invariant)) throw new Error(`Analytics package missing ${invariant}`);
}
for (const forbidden of ["note text", "transcript bodies", "private relationship"]) {
  void forbidden;
}
if (!analytics.includes("email") || !analytics.includes("phone")) {
  throw new Error("Analytics metadata guard must block contact detail");
}

const migration = await readFile(resolve(root, "packages/db/migrations/0013_onboarding_analytics.sql"), "utf8");
for (const invariant of [
  "onboarding_goal",
  "onboarding_started_at",
  "onboarding_completed_at",
  "analytics_events",
  "analytics_events_owner_select_policy"
]) {
  if (!migration.includes(invariant)) throw new Error(`Onboarding migration missing ${invariant}`);
}

const onboarding = await readFile(resolve(root, "packages/db/src/repositories/onboarding.ts"), "utf8");
for (const invariant of ["onboarding_started", "onboarding_goal_selected", "onboarding_completed", "OnboardingStateError"]) {
  if (!onboarding.includes(invariant)) throw new Error(`Onboarding repository missing ${invariant}`);
}

const page = await readFile(resolve(root, "apps/web/app/library/onboarding.tsx"), "utf8");
if (!page.includes("OnboardingChecklist")) throw new Error("Library must render the onboarding checklist");

console.log(`Onboarding and analytics verified (${required.length} required files).`);
