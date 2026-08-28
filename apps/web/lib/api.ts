import type { AuthUser } from "@lifegraph/auth";
import { ObjectNotFoundError, ObjectTypeConflictError, PermissionDeniedError, PermissionNotFoundError, RevisionConflictError } from "@lifegraph/db";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getAuthService } from "./auth";
import { InactiveAccountError, provisionActor } from "./actor";
import { getObjectRepository } from "./db";

export type ApiContext = { actor: AuthUser; requestId: string };

class InvalidJsonError extends Error {}

export function requestId(request: NextRequest) {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function apiError(code: string, message: string, status: number, currentRequestId: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, requestId: currentRequestId, ...(details ? { details } : {}) } },
    { status, headers: { "x-request-id": currentRequestId } }
  );
}

export async function requireApiContext(request: NextRequest): Promise<ApiContext | NextResponse> {
  const currentRequestId = requestId(request);
  const actor = await (await getAuthService()).currentUser();
  if (!actor) return apiError("UNAUTHENTICATED", "Authentication is required.", 401, currentRequestId);

  return { actor: await provisionActor(actor), requestId: currentRequestId };
}

export async function parseJson<T>(request: NextRequest, schema: ZodType<T>) {
  try {
    return schema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) throw error;
    throw new InvalidJsonError("Request body must be valid JSON");
  }
}

export function handleApiError(error: unknown, currentRequestId: string) {
  if (error instanceof ZodError) {
    return apiError("VALIDATION_FAILED", "The request payload is invalid.", 400, currentRequestId, error.issues);
  }
  if (error instanceof InvalidJsonError) {
    return apiError("VALIDATION_FAILED", error.message, 400, currentRequestId);
  }
  if (error instanceof InactiveAccountError) {
    return apiError("FORBIDDEN", "The account is not active.", 403, currentRequestId);
  }
  if (error instanceof RevisionConflictError) {
    return apiError("REVISION_CONFLICT", "This object changed after the supplied revision.", 409, currentRequestId);
  }
  if (error instanceof ObjectTypeConflictError) {
    return apiError("VALIDATION_FAILED", error.message, 400, currentRequestId);
  }
  if (error instanceof ObjectNotFoundError) {
    return apiError("NOT_FOUND", "The object was not found.", 404, currentRequestId);
  }
  if (error instanceof PermissionDeniedError || error instanceof PermissionNotFoundError) {
    return apiError("NOT_FOUND", "The object or permission was not found.", 404, currentRequestId);
  }
  return apiError("INTERNAL_ERROR", "The request could not be completed.", 500, currentRequestId);
}

export function apiData(data: unknown, currentRequestId: string, status = 200) {
  return NextResponse.json({ data }, { status, headers: { "x-request-id": currentRequestId } });
}
