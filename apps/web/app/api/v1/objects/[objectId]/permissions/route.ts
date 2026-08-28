import { grantPermissionInputSchema } from "@lifegraph/permissions";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, parseJson, requireApiContext, requestId } from "@/lib/api";
import { getPermissionRepository } from "@/lib/db";

type RouteContext = { params: Promise<{ objectId: string }> };
const objectGrantSchema = grantPermissionInputSchema.superRefine((value, context) => {
  if (value.principalType !== "USER" || !z.uuid().safeParse(value.principalId).success) {
    context.addIssue({ code: "custom", path: ["principalId"], message: "Object sharing currently requires a USER UUID" });
  }
});

export async function GET(request: NextRequest, { params }: RouteContext) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const objectId = z.uuid().parse((await params).objectId);
    return apiData(await getPermissionRepository().list(context.actor.id, objectId), context.requestId);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const objectId = z.uuid().parse((await params).objectId);
    const input = await parseJson(request, objectGrantSchema);
    return apiData(
      await getPermissionRepository().grant(context.actor.id, objectId, input, context.requestId),
      context.requestId,
      201
    );
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}
