import { createObjectInputSchema } from "@lifegraph/domain";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, parseJson, requireApiContext, requestId } from "@/lib/api";
import { getObjectRepository } from "@/lib/db";
import { withIdempotency } from "@/lib/idempotency";

export async function GET(request: NextRequest) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return apiData(await getObjectRepository().list(context.actor.id, Number.isFinite(limit) ? limit : 50), context.requestId);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}

/**
 * Creates an object. A retried request carrying the same Idempotency-Key
 * receives the stored response instead of creating a duplicate.
 */
export async function POST(request: NextRequest) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const input = await parseJson(request, createObjectInputSchema);
    return withIdempotency(request, context.actor.id, async () => ({
      status: 201,
      body: { data: await getObjectRepository().create(context.actor.id, input) }
    }));
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}
