import type { AuthUser } from "@lifegraph/auth";
import { AIOperationDecisionError, AIOperationNotFoundError, AIOperationValidationError, FileNotFoundError, FileStateError, ImportNotFoundError, ImportStateError, MergeCandidateNotFoundError, MergeCandidateStateError, MergeNotApplicableError, ObjectNotFoundError, ObjectTypeConflictError, PermissionDeniedError, PermissionNotFoundError, RelationshipNotFoundError, RelationshipValidationError, RetrievalValidationError, RevisionConflictError } from "@lifegraph/db";
import { ImportValidationError } from "@lifegraph/imports";
import { ImportProviderError } from "@lifegraph/imports/google-drive";
import { StorageValidationError } from "@lifegraph/storage";
import { StorageProviderError } from "@lifegraph/storage/supabase";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getAuthService } from "./auth";
import { InactiveAccountError, provisionActor } from "./actor";
import { ImportProviderUnavailableError } from "./imports";

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
  if (error instanceof RelationshipValidationError) return apiError("VALIDATION_FAILED", error.message, 400, currentRequestId);
  if (error instanceof RelationshipNotFoundError) return apiError("NOT_FOUND", "The relationship was not found.", 404, currentRequestId);
  if (error instanceof AIOperationValidationError) return apiError("AI_OUTPUT_INVALID", error.message, 400, currentRequestId);
  if (error instanceof RetrievalValidationError) return apiError("RETRIEVAL_INVALID", error.message, 400, currentRequestId);
  if (error instanceof StorageValidationError || error instanceof ImportValidationError) return apiError("VALIDATION_FAILED", error.message, 400, currentRequestId);
  if (error instanceof MergeNotApplicableError) return apiError("VALIDATION_FAILED", error.message, 400, currentRequestId);
  if (error instanceof MergeCandidateStateError) return apiError("MERGE_STATE_CONFLICT", error.message, 409, currentRequestId);
  if (error instanceof MergeCandidateNotFoundError) return apiError("NOT_FOUND", "The merge candidate was not found.", 404, currentRequestId);
  if (error instanceof ImportStateError) return apiError("IMPORT_STATE_CONFLICT", error.message, 409, currentRequestId);
  if (error instanceof ImportNotFoundError) return apiError("NOT_FOUND", "The import was not found.", 404, currentRequestId);
  if (error instanceof ImportProviderError) return apiError("IMPORT_PROVIDER_ERROR", "The import provider could not be reached.", 502, currentRequestId);
  if (error instanceof ImportProviderUnavailableError) return apiError("IMPORT_PROVIDER_UNAVAILABLE", error.message, 501, currentRequestId);
  if (error instanceof FileStateError) return apiError("FILE_STATE_CONFLICT", error.message, 409, currentRequestId);
  if (error instanceof FileNotFoundError) return apiError("NOT_FOUND", "The file was not found.", 404, currentRequestId);
  if (error instanceof StorageProviderError) return apiError("STORAGE_UNAVAILABLE", "File storage is unavailable.", 503, currentRequestId);
  if (error instanceof AIOperationDecisionError) return apiError("AI_OPERATION_DECIDED", "This proposal has already been decided.", 409, currentRequestId);
  if (error instanceof AIOperationNotFoundError) return apiError("NOT_FOUND", "The AI operation was not found.", 404, currentRequestId);
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
