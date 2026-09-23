import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, handleApiError, requestId } from "@/lib/api";

export function GET(request: NextRequest) {
  const currentRequestId = requestId(request);
  try {
    checkRateLimit(request);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
  // Presence only, never values: readiness must not expose secrets.
  const checks = {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  };
  const configured = checks.databaseUrl && checks.supabaseUrl && checks.supabaseAnonKey;

  return NextResponse.json(
    { status: configured ? "ready" : "configuration_required", service: "lifegraph-web", checks },
    { status: configured ? 200 : 503 }
  );
}
