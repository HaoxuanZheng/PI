import { NextResponse, type NextRequest } from "next/server";
import { getAuthService } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/auth?error=invalid-confirmation", request.url));

  const auth = await getAuthService();
  const result = await auth.exchangeConfirmationCode(code);
  return NextResponse.redirect(new URL(result.ok ? "/auth/reset-password" : "/auth?error=invalid-confirmation", request.url));
}
