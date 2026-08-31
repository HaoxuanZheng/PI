import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getPublicationRepository } from "@/lib/db";

type Context = { params: Promise<{ publicationId: string }> };

/** Unpublishing takes effect immediately. */
export async function DELETE(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const publicationId = z.uuid().parse((await params).publicationId);
    return apiData(await getPublicationRepository().unpublish(ctx.actor.id, publicationId, ctx.requestId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
