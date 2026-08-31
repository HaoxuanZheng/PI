import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getImportRepository } from "@/lib/db";
import { getImportProvider } from "@/lib/imports";

type Context = { params: Promise<{ importId: string }> };

/** Processes the next batch from the run's stored cursor. */
export async function POST(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const importId = z.uuid().parse((await params).importId);
    const repository = getImportRepository();
    const run = await repository.get(ctx.actor.id, importId);
    return apiData(await repository.runBatch(ctx.actor.id, importId, getImportProvider(run.provider), ctx.requestId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
