import { createSupabaseAuthService, type AuthService } from "@lifegraph/auth";
import { parsePublicEnv } from "@lifegraph/config";
import { cookies } from "next/headers";

export async function getAuthService(): Promise<AuthService> {
  const env = parsePublicEnv(process.env);
  const cookieJar = await cookies();

  return createSupabaseAuthService({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    cookies: {
      getAll: () => cookieJar.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (values) => {
        for (const { name, value, options } of values) {
          cookieJar.set(name, value, options);
        }
      }
    }
  });
}
