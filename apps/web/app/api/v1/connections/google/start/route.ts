import { connectionProviderSchema, googleAuthUrl, isGoogleProvider } from "@lifegraph/connections";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, handleApiError, requestId, requireApiContext } from "@/lib/api";
import { getOAuthStateRepository } from "@/lib/db";

const startQuerySchema = z.object({ provider: connectionProviderSchema });

function googleRedirectUri(request: NextRequest) {
  return `${new URL(request.url).origin}/api/v1/connections/google/callback`;
}

/**
 * Starts Google OAuth consent for read-only Drive or Contacts scopes.
 * Creates a single-use state bound to the caller, then redirects out to
 * Google. Consent itself happens on Google's pages; LifeGraph never sees
 * the user's Google password.
 */
export async function GET(request: NextRequest) {
  const currentRequestId = requestId(request);
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      return apiError("OAUTH_NOT_CONFIGURED", "Google OAuth is not configured.", 501, currentRequestId);
    }
    const parsed = startQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const provider = parsed.provider;
    if (!isGoogleProvider(provider)) {
      return apiError("VALIDATION_FAILED", "Google OAuth covers Drive and Contacts only.", 400, currentRequestId);
    }
    const state = await getOAuthStateRepository().create(ctx.actor.id, provider);
    return NextResponse.redirect(
      googleAuthUrl({ clientId, redirectUri: googleRedirectUri(request), provider, state })
    );
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
}
