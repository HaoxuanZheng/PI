import Link from "next/link";
import { signIn, signUp } from "./actions";

type AuthPageProps = {
  searchParams: Promise<{ error?: string; mode?: string; notice?: string }>;
};

const errorMessages: Record<string, string> = {
  "invalid-input": "Enter a valid email and a password of at least eight characters.",
  "sign-in": "We could not sign you in with those credentials.",
  "sign-up": "We could not create your account. Try again in a moment.",
  "invalid-confirmation": "That confirmation link is invalid or expired."
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const query = await searchParams;
  const isSignUp = query.mode === "signup";

  return (
    <main className="authShell">
      <section className="authCard" aria-labelledby="auth-title">
        <Link className="back" href="/">← LifeGraph</Link>
        <p className="eyebrow">Private by default</p>
        <h1 id="auth-title">{isSignUp ? "Create your space." : "Welcome back."}</h1>
        <p className="muted">Your account is the boundary around your future Personal Graph.</p>
        {query.notice === "check-email" ? <p className="notice">Check your email to confirm your account.</p> : null}
        {query.error ? <p className="notice error" role="alert">{errorMessages[query.error] ?? "Something went wrong."}</p> : null}
        <form action={isSignUp ? signUp : signIn}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input autoComplete="email" id="email" name="email" required type="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input autoComplete={isSignUp ? "new-password" : "current-password"} id="password" minLength={8} name="password" required type="password" />
          </div>
          <div className="formActions">
            <button className="button" type="submit">{isSignUp ? "Create account" : "Sign in"}</button>
            <Link className="button buttonSecondary" href={isSignUp ? "/auth" : "/auth?mode=signup"}>
              {isSignUp ? "I have an account" : "Create account"}
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
