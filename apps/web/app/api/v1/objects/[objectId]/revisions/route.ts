import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requireApiContext, requestId } from "@/lib/api";
import { getObjectRepository } from "@/lib/db";

type RouteContext = { params: Promise<{ objectId: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const { objectId } = await params;
    return apiData(await getObjectRepository().revisions(context.actor.id, z.uuid().parse(objectId)), context.requestId);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}
