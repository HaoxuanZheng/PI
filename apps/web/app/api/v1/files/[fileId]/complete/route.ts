import { completeUploadInputSchema } from "@lifegraph/storage";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getFileRepository } from "@/lib/db";

type Context = { params: Promise<{ fileId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const fileId = z.uuid().parse((await params).fileId);
    const input = await parseJson(request, completeUploadInputSchema);
    return apiData(await getFileRepository().complete(ctx.actor.id, fileId, input, ctx.requestId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
