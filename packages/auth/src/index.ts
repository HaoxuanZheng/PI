export type AuthUser = {
  id: string;
  email: string | null;
};

export type AuthResult =
  | { ok: true; user: AuthUser | null }
  | { ok: false; code: "INVALID_CREDENTIALS" | "PROVIDER_ERROR"; message: string };

export interface AuthService {
  currentUser(): Promise<AuthUser | null>;
  signInWithPassword(email: string, password: string): Promise<AuthResult>;
  signUpWithPassword(email: string, password: string): Promise<AuthResult>;
  confirmEmail(tokenHash: string, type: EmailOtpType): Promise<AuthResult>;
  signOut(): Promise<void>;
}

export type EmailOtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

export type CookieOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
};

export type CookieStore = {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: Array<{ name: string; value: string; options: CookieOptions }>): void;
};

export type SupabaseAuthConfig = {
  url: string;
  anonKey: string;
  cookies: CookieStore;
};

export async function createSupabaseAuthService(config: SupabaseAuthConfig): Promise<AuthService> {
  const { createServerClient } = await import("@supabase/ssr");
  const client = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => config.cookies.getAll(),
      setAll: (values) => config.cookies.setAll(values)
    }
  });

  const normalizeUser = (user: { id: string; email?: string } | null): AuthUser | null =>
    user ? { id: user.id, email: user.email ?? null } : null;

  return {
    async currentUser() {
      const { data, error } = await client.auth.getUser();
      if (error) return null;
      return normalizeUser(data.user);
    },
    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        return {
          ok: false,
          code: error.status === 400 ? "INVALID_CREDENTIALS" : "PROVIDER_ERROR",
          message: "Unable to sign in with those credentials."
        };
      }
      return { ok: true, user: normalizeUser(data.user) };
    },
    async signUpWithPassword(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) return { ok: false, code: "PROVIDER_ERROR", message: "Unable to create the account." };
      return { ok: true, user: normalizeUser(data.user) };
    },
    async confirmEmail(tokenHash, type) {
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) return { ok: false, code: "PROVIDER_ERROR", message: "Unable to confirm the account." };
      return { ok: true, user: normalizeUser(data.user) };
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw new Error("Unable to sign out");
    }
  };
}
