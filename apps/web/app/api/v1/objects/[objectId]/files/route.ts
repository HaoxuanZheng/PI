import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getFileRepository } from "@/lib/db";

type Context = { params: Promise<{ objectId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const objectId = z.uuid().parse((await params).objectId);
    return apiData(await getFileRepository().listForObject(ctx.actor.id, objectId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
