import { updateObjectInputSchema } from "@lifegraph/domain";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, parseJson, requireApiContext, requestId } from "@/lib/api";
import { getObjectRepository } from "@/lib/db";

type RouteContext = { params: Promise<{ objectId: string }> };
const deleteInputSchema = z.object({ expectedRevisionId: z.uuid() });

export async function GET(request: NextRequest, { params }: RouteContext) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const { objectId } = await params;
    return apiData(await getObjectRepository().get(context.actor.id, z.uuid().parse(objectId)), context.requestId);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const { objectId } = await params;
    const input = await parseJson(request, updateObjectInputSchema);
    return apiData(await getObjectRepository().update(context.actor.id, z.uuid().parse(objectId), input, context.requestId), context.requestId);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const { objectId } = await params;
    const input = await parseJson(request, deleteInputSchema);
    await getObjectRepository().softDelete(context.actor.id, z.uuid().parse(objectId), input.expectedRevisionId, context.requestId);
    return new Response(null, { status: 204, headers: { "x-request-id": context.requestId } });
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}
