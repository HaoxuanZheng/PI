import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getFileRepository } from "@/lib/db";

type Context = { params: Promise<{ fileId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const fileId = z.uuid().parse((await params).fileId);
    return apiData(await getFileRepository().get(ctx.actor.id, fileId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const fileId = z.uuid().parse((await params).fileId);
    return apiData(await getFileRepository().softDelete(ctx.actor.id, fileId, ctx.requestId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
