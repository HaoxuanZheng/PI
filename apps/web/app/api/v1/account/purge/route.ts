import type { NextRequest } from "next/server";
import { apiData, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getAccountRepository } from "@/lib/db";

/**
 * Executes a deletion request after its recovery window has elapsed.
 *
 * Guarded by DELETION_PENDING plus purge-after: requests inside the window
 * fail with DELETION_STATE_CONFLICT so a grace-period deletion is never
 * executed early. Each step is idempotent, so a failed purge can be retried
 * with the same endpoint.
 */
export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const ctx = await requireApiContext(request, { allowDeletionPending: true });
    if (ctx instanceof Response) return ctx;
    return apiData(await getAccountRepository().purgeAccount(ctx.actor.id, ctx.requestId), ctx.requestId, 201);
  } catch (error) {
    return handleApiError(error, id);
  }
}
