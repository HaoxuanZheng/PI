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
          <p className="notice" role="status">If an account exists for that email, a recovery link has been sent. Use only the newest email and do not request another link first.</p>
        ) : null}
        {query.notice === "recently-sent" ? (
          <p className="notice" role="status">A recovery link was already requested. Use the newest email or wait five minutes before requesting another.</p>
        ) : null}
        {query.error === "expired" ? (
          <p className="notice error" role="alert">That recovery link is expired or was replaced by a newer request. Wait five minutes, request one new link, and open only the newest email in this browser.</p>
        ) : query.error === "rate-limit" ? (
          <p className="notice error" role="alert">The email service has reached its sending limit. Do not retry yet; wait until the hourly limit resets, then request one link.</p>
        ) : query.error ? <p className="notice error" role="alert">We could not send a recovery link. Please try again.</p> : null}
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
