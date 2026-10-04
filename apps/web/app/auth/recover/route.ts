import { NextResponse, type NextRequest } from "next/server";
import { getAuthService } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error_code");
  if (providerError === "otp_expired" || providerError === "access_denied") {
    return NextResponse.redirect(new URL("/auth/forgot-password?error=expired", request.url));
  }
  if (!code) return NextResponse.redirect(new URL("/auth/forgot-password?error=expired", request.url));

  const auth = await getAuthService();
  const result = await auth.exchangeConfirmationCode(code);
  return NextResponse.redirect(new URL(result.ok ? "/auth/reset-password" : "/auth/forgot-password?error=expired", request.url));
}
