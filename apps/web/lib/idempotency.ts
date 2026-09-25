import { parseIdempotencyKey } from "@lifegraph/db";
import { NextResponse, type NextRequest } from "next/server";
import { requestId } from "./api";
import { getIdempotencyRepository } from "./db";

export type IdempotentResult = { status: number; body: unknown };

/**
 * Runs a POST handler once per client key and replays the stored response
 * for retried requests. Without an Idempotency-Key header the handler runs
 * normally. Handler errors drop the reservation so a retry proceeds; only
 * successes are replayed. Replays carry the current request id and an
 * x-idempotent-replay marker.
 */
export async function withIdempotency(
  request: NextRequest,
  actorId: string,
  handler: () => Promise<IdempotentResult>
): Promise<NextResponse> {
  const currentRequestId = requestId(request);
  const finish = (result: IdempotentResult, replayed: boolean) =>
    NextResponse.json(result.body, {
      status: result.status,
      headers: {
        "x-request-id": currentRequestId,
        ...(replayed ? { "x-idempotent-replay": "true" } : {})
      }
    });

  const key = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!key) return finish(await handler(), false);

  const repository = getIdempotencyRepository();
  const { pathname } = new URL(request.url);
  const stored = await repository.find(actorId, key);
  if (stored) return finish({ status: stored.statusCode, body: stored.body }, true);

  // Reserve first: a concurrent duplicate hits the unique index and becomes
  // a 409 instead of a second execution.
  await repository.reserve(actorId, key, request.method, pathname);
  try {
    const result = await handler();
    await repository.complete(actorId, key, result.status, result.body);
    return finish(result, false);
  } catch (error) {
    await repository.discard(actorId, key);
    throw error;
  }
}
