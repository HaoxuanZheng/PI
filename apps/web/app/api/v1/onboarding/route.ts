import { updateOnboardingInputSchema } from "@lifegraph/analytics";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getOnboardingRepository } from "@/lib/db";

/** Returns onboarding state plus progress toward the 10-object activation target. */
export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    return apiData(await getOnboardingRepository().status(ctx.actor.id), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}

/**
 * Advances the state machine: start, select-goal, complete.
 * Each transition records its own privacy-safe analytics event.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const input = await parseJson(request, updateOnboardingInputSchema);
    return apiData(await getOnboardingRepository().update(ctx.actor.id, input), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
