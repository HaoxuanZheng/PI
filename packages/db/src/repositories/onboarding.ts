import { count, eq, sql as statement } from "drizzle-orm";
import {
  activationObjectThreshold,
  type AnalyticsEvent,
  type AnalyticsMetadata,
  type OnboardingGoal,
  type OnboardingStatus,
  type UpdateOnboardingInput
} from "@lifegraph/analytics";
import type { DatabaseClient } from "../index";
import { AccountNotFoundError } from "./accounts";
import { analyticsEvents, objects, users } from "../schema";

export class OnboardingStateError extends Error {
  readonly code = "ONBOARDING_STATE_CONFLICT";
}

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

async function buildStatus(transaction: Transaction, ownerId: string): Promise<OnboardingStatus> {
  const [row] = await transaction.select().from(users).where(eq(users.id, ownerId)).limit(1);
  if (!row) throw new AccountNotFoundError();
  const [counter] = await transaction
    .select({ value: count() })
    .from(objects)
    .where(eq(objects.ownerId, ownerId));
  const objectCount = counter?.value ?? 0;
  return {
    started: row.onboardingStartedAt !== null,
    goal: (row.onboardingGoal ?? null) as OnboardingGoal | null,
    completed: row.onboardingCompletedAt !== null,
    startedAt: row.onboardingStartedAt?.toISOString() ?? null,
    completedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    objectCount,
    activated: objectCount >= activationObjectThreshold
  };
}

export function createOnboardingRepository(client: DatabaseClient) {
  return {
    async status(ownerId: string): Promise<OnboardingStatus> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        return buildStatus(transaction, ownerId);
      });
    },

    async update(ownerId: string, input: UpdateOnboardingInput): Promise<OnboardingStatus> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(users).where(eq(users.id, ownerId)).for("update").limit(1);
        if (!row) throw new AccountNotFoundError();

        if (input.action === "start") {
          if (row.onboardingStartedAt) throw new OnboardingStateError("Onboarding has already started");
          await transaction.update(users).set({ onboardingStartedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, ownerId));
          await transaction.insert(analyticsEvents).values({ userId: ownerId, eventName: "onboarding_started", metadata: {} });
        } else if (input.action === "select-goal") {
          if (!row.onboardingStartedAt) throw new OnboardingStateError("Start onboarding before selecting a goal");
          if (!input.goal) throw new OnboardingStateError("A goal is required");
          await transaction.update(users).set({ onboardingGoal: input.goal, updatedAt: new Date() }).where(eq(users.id, ownerId));
          await transaction.insert(analyticsEvents).values({
            userId: ownerId,
            eventName: "onboarding_goal_selected",
            metadata: { goal: input.goal }
          });
        } else {
          if (!row.onboardingStartedAt) throw new OnboardingStateError("Start onboarding before completing it");
          if (row.onboardingCompletedAt) throw new OnboardingStateError("Onboarding is already complete");
          await transaction.update(users).set({ onboardingCompletedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, ownerId));
          await transaction.insert(analyticsEvents).values({ userId: ownerId, eventName: "onboarding_completed", metadata: {} });
        }

        const status = await buildStatus(transaction, ownerId);
        return status;
      });
    },

    async recordEvent(ownerId: string, event: AnalyticsEvent, metadata: AnalyticsMetadata = {}) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
        if (!row) throw new AccountNotFoundError();
        const [inserted] = await transaction
          .insert(analyticsEvents)
          .values({ userId: ownerId, eventName: event, metadata })
          .returning();
        return inserted;
      });
    }
  };
}
