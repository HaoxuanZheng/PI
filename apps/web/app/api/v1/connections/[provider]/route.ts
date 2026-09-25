import { connectionProviderSchema } from "@lifegraph/connections";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getConnectionRepository } from "@/lib/db";

type Context = { params: Promise<{ provider: string }> };

/** Removes the stored token. Importers fall back to operator tokens. */
export async function DELETE(request: NextRequest, { params }: Context) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const provider = connectionProviderSchema.parse((await params).provider);
    await getConnectionRepository().disconnect(ctx.actor.id, provider, ctx.requestId);
    return apiData({ disconnected: provider }, ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
