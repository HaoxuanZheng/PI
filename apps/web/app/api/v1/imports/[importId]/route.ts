import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getImportRepository } from "@/lib/db";

type Context = { params: Promise<{ importId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const importId = z.uuid().parse((await params).importId);
    return apiData(await getImportRepository().get(ctx.actor.id, importId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
