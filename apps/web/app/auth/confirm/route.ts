import type { EmailOtpType } from "@lifegraph/auth";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthService } from "@/lib/auth";

const otpTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const candidateType = request.nextUrl.searchParams.get("type");

  if (!tokenHash || !candidateType || !otpTypes.has(candidateType as EmailOtpType)) {
    return NextResponse.redirect(new URL("/auth?error=invalid-confirmation", request.url));
  }

  const auth = await getAuthService();
  const result = await auth.confirmEmail(tokenHash, candidateType as EmailOtpType);
  return NextResponse.redirect(new URL(result.ok ? "/library" : "/auth?error=invalid-confirmation", request.url));
}
