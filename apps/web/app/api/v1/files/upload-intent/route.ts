import { uploadIntentInputSchema } from "@lifegraph/storage";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getFileRepository } from "@/lib/db";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const input = await parseJson(request, uploadIntentInputSchema);
    return apiData(await getFileRepository().createIntent(ctx.actor.id, input, ctx.requestId), ctx.requestId, 201);
  } catch (error) {
    return handleApiError(error, id);
  }
}
