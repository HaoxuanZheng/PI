import { startImportInputSchema } from "@lifegraph/imports";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getImportRepository } from "@/lib/db";
import { getImportProvider } from "@/lib/imports";

/**
 * Reserves a run and processes its first batch.
 *
 * Batches are driven by explicit requests rather than a background worker in V0.11, so a large
 * import is continued with `POST /imports/:importId/continue` until `done` is true.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const input = await parseJson(request, startImportInputSchema);
    const adapter = getImportProvider(input.provider);
    const repository = getImportRepository();
    const run = await repository.start(ctx.actor.id, input.provider, ctx.requestId);
    return apiData(await repository.runBatch(ctx.actor.id, run.id, adapter, ctx.requestId), ctx.requestId, 201);
  } catch (error) {
    return handleApiError(error, id);
  }
}
