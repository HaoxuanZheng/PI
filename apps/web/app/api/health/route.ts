import { NextResponse } from "next/server";

export function GET() {
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
