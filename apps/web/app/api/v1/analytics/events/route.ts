import { recordAnalyticsEventInputSchema } from "@lifegraph/analytics";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getOnboardingRepository } from "@/lib/db";

/**
 * Records one privacy-safe product analytics event.
 *
 * The allowlist and metadata guard live in @lifegraph/analytics: unknown
 * events fail validation, and any metadata key resembling a body, transcript,
 * or contact field fails before insert. Analytics never carries private content.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const input = await parseJson(request, recordAnalyticsEventInputSchema);
    return apiData(
      await getOnboardingRepository().recordEvent(ctx.actor.id, input.event, input.metadata),
      ctx.requestId,
      201
    );
  } catch (error) {
    return handleApiError(error, id);
  }
}
