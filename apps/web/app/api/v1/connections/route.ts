import { connectInputSchema } from "@lifegraph/connections";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getConnectionRepository } from "@/lib/db";

/**
 * Stores a user's provider token. Plaintext touches memory only; the row
 * carries sealed blobs and status reads never return token material.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const input = await parseJson(request, connectInputSchema);
    return apiData(await getConnectionRepository().connect(ctx.actor.id, input, ctx.requestId), ctx.requestId, 201);
  } catch (error) {
    return handleApiError(error, id);
  }
}

/** Lists connection status. Token material is never returned. */
export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    return apiData(await getConnectionRepository().status(ctx.actor.id), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
