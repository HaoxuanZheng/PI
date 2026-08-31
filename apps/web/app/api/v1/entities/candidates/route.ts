import type { NextRequest } from "next/server";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getEntityRepository } from "@/lib/db";

/** Lists pending duplicate proposals, strongest first. */
export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    return apiData(await getEntityRepository().listCandidates(ctx.actor.id), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
