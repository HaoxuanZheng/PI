import { previewObjectInputSchema, previewProfileInputSchema } from "@lifegraph/publications";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getPublicationRepository } from "@/lib/db";

const schema = z.union([previewObjectInputSchema, previewProfileInputSchema]);

/**
 * Returns exactly what publishing would store, so the user sees precisely what outsiders would see
 * before anything becomes public. Nothing is persisted.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const input = await parseJson(request, schema);
    const repository = getPublicationRepository();
    const preview = "sourceObjectId" in input
      ? await repository.previewObject(ctx.actor.id, input.sourceObjectId, input.fields)
      : await repository.previewProfile(ctx.actor.id, { ...input, confirm: true });
    return apiData(preview, ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
