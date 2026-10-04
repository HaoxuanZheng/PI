import Link from "next/link";
import { requestPasswordReset } from "../actions";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const query = await searchParams;

  return (
    <main className="authShell">
      <section className="authCard" aria-labelledby="auth-title">
        <Link className="back" href="/auth">← Sign in</Link>
        <p className="eyebrow">Account recovery</p>
        <h1 id="auth-title">Reset your password.</h1>
        <p className="muted">Enter your account email and PI will send a secure recovery link.</p>
        {query.notice === "check-email" ? (
          <p className="notice" role="status">If an account exists for that email, a recovery link has been sent. Check your spam folder too.</p>
        ) : null}
        {query.error ? <p className="notice error" role="alert">We could not send a recovery link. Please try again.</p> : null}
        <form action={requestPasswordReset}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input autoComplete="email" id="email" name="email" required type="email" />
          </div>
          <button className="button" type="submit">Send recovery link</button>
        </form>
      </section>
    </main>
  );
}
