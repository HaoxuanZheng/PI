import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getImportRepository } from "@/lib/db";
import { getImportProvider } from "@/lib/imports";

type Context = { params: Promise<{ importId: string }> };

/** Re-opens a failed run at its stored cursor and processes the next batch. */
export async function POST(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const importId = z.uuid().parse((await params).importId);
    const repository = getImportRepository();
    const reopened = await repository.resume(ctx.actor.id, importId, ctx.requestId);
    return apiData(await repository.runBatch(ctx.actor.id, importId, getImportProvider(reopened.provider), ctx.requestId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
