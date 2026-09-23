import { requestDeletionInputSchema } from "@lifegraph/privacy";
import type { NextRequest } from "next/server";
import { apiData, handleApiError, parseJson, requestId, requireApiContext } from "@/lib/api";
import { getAccountRepository } from "@/lib/db";

/**
 * Requests account deletion with a 7-day recovery window.
 *
 * The account is disabled immediately (DELETION_PENDING fails provisioning),
 * while the purge itself is not due until purgeAfter. Purge execution is a
 * future milestone; this endpoint records the request honestly and audits it.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    await parseJson(request, requestDeletionInputSchema);
    return apiData(await getAccountRepository().requestDeletion(ctx.actor.id, ctx.requestId), ctx.requestId, 201);
  } catch (error) {
    return handleApiError(error, id);
  }
}

export async function GET(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request, { allowDeletionPending: true });
    if (ctx instanceof Response) return ctx;
    return apiData(await getAccountRepository().status(ctx.actor.id), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}

/** Cancels a pending deletion inside the recovery window and re-activates the account. */
export async function DELETE(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request, { allowDeletionPending: true });
    if (ctx instanceof Response) return ctx;
    return apiData(await getAccountRepository().cancelDeletion(ctx.actor.id, ctx.requestId), ctx.requestId);
  } catch (error) {
    return handleApiError(error, id);
  }
}
