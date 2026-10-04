import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthService } from "@/lib/auth";
import { updatePassword } from "../actions";

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const auth = await getAuthService();
  if (!await auth.currentUser()) redirect("/auth?error=invalid-confirmation");
  const query = await searchParams;

  return (
    <main className="authShell">
      <section className="authCard" aria-labelledby="auth-title">
        <Link className="back" href="/">← PI</Link>
        <p className="eyebrow">Account recovery</p>
        <h1 id="auth-title">Choose a new password.</h1>
        <p className="muted">Use at least eight characters. Your new password takes effect immediately.</p>
        {query.error ? <p className="notice error" role="alert">We could not update your password. Please try again.</p> : null}
        <form action={updatePassword}>
          <div className="field">
            <label htmlFor="password">New password</label>
            <input autoComplete="new-password" id="password" minLength={8} name="password" required type="password" />
          </div>
          <button className="button" type="submit">Update password</button>
        </form>
      </section>
    </main>
  );
}
