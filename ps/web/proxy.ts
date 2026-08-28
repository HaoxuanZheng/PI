import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAuthService } from "@lifegraph/auth";
import { parsePublicEnv } from "@lifegraph/config";

export async function proxy(request: NextRequest) {
  const env = parsePublicEnv(process.env);
  let response = NextResponse.next({ request });

  const auth = await createSupabaseAuthService({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    cookies: {
      getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (values) => {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      }
    }
  });

  await auth.currentUser();
  return response;
}

export const config = {
  matcher: ["/library/:path*", "/api/v1/:path*", "/auth/confirm"]
};
