import { exchangeGoogleCode, googleScopes, isGoogleProvider } from "@lifegraph/connections";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requestId, requireApiContext } from "@/lib/api";
import { getConnectionRepository, getOAuthStateRepository } from "@/lib/db";

const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

function libraryUrl(request: NextRequest, query: string) {
  return `${new URL(request.url).origin}/library${query}`;
}

/**
 * Completes Google OAuth consent: consumes the caller's state exactly once,
 * exchanges the code, and seals the tokens into the vault. Every failure
 * redirects back to the library with an error flag instead of leaking
 * provider detail; no token material ever appears in URLs.
 */
export async function GET(request: NextRequest) {
  const failed = (code: string) => NextResponse.redirect(libraryUrl(request, `?error=${code}`));
  try {
    const ctx = await requireApiContext(request);
    if (ctx instanceof Response) return ctx;
    const params = new URL(request.url).searchParams;
    const parsed = callbackQuerySchema.safeParse({ code: params.get("code"), state: params.get("state") });
    if (!parsed.success) return failed("oauth-invalid");
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return failed("oauth-not-configured");
    let provider;
    try {
      provider = await getOAuthStateRepository().consume(ctx.actor.id, parsed.data.state);
    } catch {
      return failed("oauth-state");
    }
    // States are minted for Google providers only; anything else is rejected
    // rather than storing Google tokens under the wrong provider.
    if (!isGoogleProvider(provider)) return failed("oauth-state");
    let tokens;
    try {
      tokens = await exchangeGoogleCode({
        clientId,
        clientSecret,
        redirectUri: `${new URL(request.url).origin}/api/v1/connections/google/callback`,
        code: parsed.data.code
      });
    } catch {
      return failed("oauth-exchange");
    }
    await getConnectionRepository().connect(
      ctx.actor.id,
      {
        provider,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        scopes: googleScopes(provider),
        expiresInSeconds: tokens.expires_in
      },
      requestId(request)
    );
    return NextResponse.redirect(libraryUrl(request, `?connected=${provider.toLowerCase()}`));
  } catch {
    return failed("oauth-failed");
  }
}
