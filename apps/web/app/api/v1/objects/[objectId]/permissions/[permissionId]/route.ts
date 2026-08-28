import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requireApiContext, requestId } from "@/lib/api";
import { getPermissionRepository } from "@/lib/db";

type RouteContext = { params: Promise<{ objectId: string; permissionId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const currentRequestId = requestId(request);
  try {
    const context = await requireApiContext(request);
    if (context instanceof Response) return context;
    const route = await params;
    const objectId = z.uuid().parse(route.objectId);
    const permissionId = z.uuid().parse(route.permissionId);
    return apiData(
      await getPermissionRepository().revoke(context.actor.id, objectId, permissionId, context.requestId),
      context.requestId
    );
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}
