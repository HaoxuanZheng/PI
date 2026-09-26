import type { AuthUser } from "@lifegraph/auth";
import { AIOperationDecisionError, AIOperationNotFoundError, AIOperationValidationError, ConnectionNotFoundError, FileNotFoundError, FileStateError, IdempotencyInFlightError, IdempotencyKeyError, ImportNotFoundError, ImportStateError, MergeCandidateNotFoundError, MergeCandidateStateError, MergeNotApplicableError, OnboardingStateError, PublicationNotFoundError, PublicationStateError, ObjectNotFoundError, ObjectTypeConflictError, PermissionDeniedError, PermissionNotFoundError, RelationshipNotFoundError, RelationshipValidationError, RetrievalValidationError, RevisionConflictError } from "@lifegraph/db";
import { ImportValidationError } from "@lifegraph/imports";
import { PublicationValidationError } from "@lifegraph/publications";
import { ImportProviderError } from "@lifegraph/imports/google-drive";
import { StorageValidationError } from "@lifegraph/storage";
import { StorageProviderError } from "@lifegraph/storage/supabase";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getAuthService } from "./auth";
import { bucketAndKeyFor, getRateLimiter } from "./ratelimit";
import { InactiveAccountError, provisionActor, provisionActorAllowingPendingDeletion } from "./actor";
import { ImportProviderUnavailableError } from "./imports";
import { AccountDeletionStateError, AccountNotFoundError } from "@lifegraph/db";
import { AnalyticsValidationError } from "@lifegraph/analytics";
import { ExportOwnershipError, PrivacyValidationError } from "@lifegraph/privacy";
import { ConnectionCryptoError, ConnectionValidationError } from "@lifegraph/connections";
import { AIProviderNotConfiguredError } from "./ai";

export type ApiContext = { actor: AuthUser; requestId: string };

class InvalidJsonError extends Error {}

export class RateLimitedError extends Error {
  readonly code = "RATE_LIMITED";
  constructor(
    readonly retryAfterSeconds: number,
    readonly limit: number
  ) {
    super("The request rate limit was exceeded.");
  }
}

export function checkRateLimit(request: NextRequest, actorId?: string) {
  const { bucket, key } = bucketAndKeyFor(request, actorId);
  const decision = getRateLimiter().check(key, bucket);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds, decision.limit);
}

export function rateLimitHeaders(error: RateLimitedError) {
  return { "retry-after": String(error.retryAfterSeconds), "x-ratelimit-limit": String(error.limit) };
}

export function requestId(request: NextRequest) {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function apiError(code: string, message: string, status: number, currentRequestId: string, details?: unknown, headers?: Record<string, string>) {
  logApiError(code, status, currentRequestId);
  return NextResponse.json(
    { error: { code, message, requestId: currentRequestId, ...(details ? { details } : {}) } },
    { status, headers: { "x-request-id": currentRequestId, ...(headers ?? {}) } }
  );
}

/**
 * Structured server log for every API failure.
 *
 * Code, status, and requestId only. Request bodies, snapshots, note text,
 * and user ids never enter general application logs per the privacy
 * invariant; security-sensitive actions have their own metadata-only audit
 * events in the database.
 */
export function logApiError(code: string, status: number, currentRequestId: string) {
  const line = JSON.stringify({ level: status >= 500 ? "error" : "warn", code, status, requestId: currentRequestId });
  if (status >= 500) console.error(line);
  else console.warn(line);
}

export async function requireApiContext(request: NextRequest, options: { allowDeletionPending?: boolean } = {}): Promise<ApiContext | NextResponse> {
  const currentRequestId = requestId(request);
  // Bound unauthenticated abuse before touching auth: too many anonymous
  // requests from one client never reach session lookup.
  try {
    checkRateLimit(request);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
  const actor = await (await getAuthService()).currentUser();
  if (!actor) return apiError("UNAUTHENTICATED", "Authentication is required.", 401, currentRequestId);

  try {
    checkRateLimit(request, actor.id);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }

  try {
    const provisioned = options.allowDeletionPending
      ? await provisionActorAllowingPendingDeletion(actor)
      : await provisionActor(actor);
    return { actor: provisioned, requestId: currentRequestId };
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
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
  if (error instanceof AIProviderNotConfiguredError) {
    return apiError("AI_PROVIDER_NOT_CONFIGURED", error.message, 503, currentRequestId);
  }
  if (error instanceof RateLimitedError) {
    return apiError("RATE_LIMITED", error.message, 429, currentRequestId, undefined, rateLimitHeaders(error));
  }
  if (error instanceof ZodError) {
    return apiError("VALIDATION_FAILED", "The request payload is invalid.", 400, currentRequestId, error.issues);
  }
  if (error instanceof InvalidJsonError) {
    return apiError("VALIDATION_FAILED", error.message, 400, currentRequestId);
  }
  if (error instanceof InactiveAccountError) {
    return apiError("FORBIDDEN", "The account is not active.", 403, currentRequestId);
  }
  if (error instanceof AccountNotFoundError || error instanceof ConnectionNotFoundError) {
    return apiError("NOT_FOUND", "The account or connection was not found.", 404, currentRequestId);
  }
  if (error instanceof ConnectionCryptoError) {
    return apiError("INTERNAL_ERROR", "The request could not be completed.", 500, currentRequestId);
  }
  if (error instanceof AccountDeletionStateError) {
    return apiError("DELETION_STATE_CONFLICT", error.message, 409, currentRequestId);
  }
  if (error instanceof PrivacyValidationError || error instanceof AnalyticsValidationError || error instanceof IdempotencyKeyError || error instanceof ConnectionValidationError) {
    return apiError("VALIDATION_FAILED", error.message, 400, currentRequestId);
  }
  if (error instanceof IdempotencyInFlightError) {
    return apiError("IDEMPOTENCY_CONFLICT", error.message, 409, currentRequestId, undefined, { "retry-after": "1" });
  }
  if (error instanceof OnboardingStateError) {
    return apiError("ONBOARDING_STATE_CONFLICT", error.message, 409, currentRequestId);
  }
  if (error instanceof ExportOwnershipError) {
    return apiError("INTERNAL_ERROR", "The export could not be completed.", 500, currentRequestId);
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
  if (error instanceof PublicationValidationError) return apiError("VALIDATION_FAILED", error.message, 400, currentRequestId);
  if (error instanceof PublicationStateError) return apiError("PUBLICATION_STATE_CONFLICT", error.message, 409, currentRequestId);
  if (error instanceof PublicationNotFoundError) return apiError("NOT_FOUND", "The publication was not found.", 404, currentRequestId);
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
