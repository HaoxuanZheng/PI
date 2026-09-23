import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, handleApiError, requestId } from "@/lib/api";

export function GET(request: NextRequest) {
  const currentRequestId = requestId(request);
  try {
    checkRateLimit(request);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
  const configured = Boolean(
    process.env.DATABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  return NextResponse.json(
    { status: configured ? "ready" : "configuration_required", service: "lifegraph-web" },
    { status: configured ? 200 : 503 }
  );
}
