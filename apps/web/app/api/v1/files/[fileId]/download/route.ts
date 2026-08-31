import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getFileRepository } from "@/lib/db";

type Context = { params: Promise<{ fileId: string }> };

/** Returns a short-lived signed URL rather than proxying private bytes through the application. */
export async function POST(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const fileId = z.uuid().parse((await params).fileId);
    return apiData(await getFileRepository().createDownloadUrl(ctx.actor.id, fileId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
