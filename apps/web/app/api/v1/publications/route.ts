import { publishObjectInputSchema, publishProfileInputSchema } from "@lifegraph/publications";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getPublicationRepository } from "@/lib/db";

const schema = z.union([publishObjectInputSchema, publishProfileInputSchema]);

/** Publishes an object page, a profile, or a professional view. Confirmation is mandatory. */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const input = await parseJson(request, schema);
    const repository = getPublicationRepository();
    const published = "sourceObjectId" in input
      ? await repository.publishObject(ctx.actor.id, input, ctx.requestId)
      : await repository.publishProfile(ctx.actor.id, input, ctx.requestId);
    return apiData(published, ctx.requestId, 201);
  } catch (error) {
    return handleApiError(error, id);
  }
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const repository = getPublicationRepository();
    return apiData({
      publications: await repository.listMine(ctx.actor.id),
      stale: await repository.staleness(ctx.actor.id)
    }, ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
