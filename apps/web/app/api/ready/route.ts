import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, handleApiError, requestId } from "@/lib/api";
import { getDatabaseClient } from "@/lib/db";

/**
 * Readiness probe for load balancers and container orchestration.
 *
 * Unlike /api/health (liveness, never touches the database), this endpoint
 * runs one trivial query so a lost database fails traffic routing instead
 * of serving errors. It reports presence booleans, never secret values, and
 * stays rate-limited. Query failures return 503 without leaking driver detail.
 */
export async function GET(request: NextRequest) {
  const currentRequestId = requestId(request);
  try {
    checkRateLimit(request);
  } catch (error) {
    return handleApiError(error, currentRequestId);
  }
  const checks = {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    database: false
  };
  if (!checks.databaseUrl) {
    return NextResponse.json(
      { status: "not_ready", service: "lifegraph-web", checks },
      { status: 503, headers: { "x-request-id": currentRequestId } }
    );
  }
  try {
    await getDatabaseClient().sql`select 1 as ok`;
    checks.database = true;
  } catch {
    return NextResponse.json(
      { status: "not_ready", service: "lifegraph-web", checks },
      { status: 503, headers: { "x-request-id": currentRequestId } }
    );
  }
  return NextResponse.json(
    { status: "ready", service: "lifegraph-web", checks },
    { status: 200, headers: { "x-request-id": currentRequestId } }
  );
}
