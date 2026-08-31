import type { NextRequest } from "next/server";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getEntityRepository } from "@/lib/db";

/**
 * Recomputes duplicate proposals across the caller's people using deterministic signals only.
 * Nothing is merged here; every proposal awaits an explicit decision.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    return apiData(await getEntityRepository().detect(ctx.actor.id, ctx.requestId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
