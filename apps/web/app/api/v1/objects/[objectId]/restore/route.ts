import { restoreRevisionInputSchema } from "@lifegraph/domain";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, parseJson, requireApiContext, requestId } from "@/lib/api";
import { getObjectRepository } from "@/lib/db";

type RouteContext = { params: Promise<{ objectId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const { objectId } = await params;
    const input = await parseJson(request, restoreRevisionInputSchema);
    return apiData(await getObjectRepository().restore(context.actor.id, z.uuid().parse(objectId), input, context.requestId), context.requestId);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}
