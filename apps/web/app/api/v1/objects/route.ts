import { createObjectInputSchema } from "@lifegraph/domain";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, parseJson, requireApiContext, requestId } from "@/lib/api";
import { getObjectRepository } from "@/lib/db";

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

export async function POST(request: NextRequest) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const input = await parseJson(request, createObjectInputSchema);
    const created = await getObjectRepository().create(context.actor.id, input);
    return apiData(created, context.requestId, 201);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}
