"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { getAuthService } from "@/lib/auth";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128)
});

function credentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });
}

export async function signIn(formData: FormData) {
  const parsed = credentials(formData);
  if (!parsed.success) redirect("/auth?error=invalid-input");

  const auth = await getAuthService();
  const result = await auth.signInWithPassword(parsed.data.email, parsed.data.password);
  if (!result.ok) redirect("/auth?error=sign-in");
  redirect("/library");
}

export async function signUp(formData: FormData) {
  const parsed = credentials(formData);
  if (!parsed.success) redirect("/auth?mode=signup&error=invalid-input");

  const auth = await getAuthService();
  const result = await auth.signUpWithPassword(parsed.data.email, parsed.data.password);
  if (!result.ok) redirect("/auth?mode=signup&error=sign-up");
  redirect(result.requiresEmailConfirmation ? "/auth?notice=check-email" : "/library");
}

export async function requestPasswordReset(formData: FormData) {
  const email = z.email().safeParse(formData.get("email"));
  if (!email.success) redirect("/auth/forgot-password?error=invalid-input");

  const cookieJar = await cookies();
  const lastRequest = Number(cookieJar.get("pi-recovery-sent-at")?.value ?? 0);
  if (Number.isFinite(lastRequest) && Date.now() - lastRequest < 5 * 60_000) {
    redirect("/auth/forgot-password?notice=recently-sent");
  }

  const auth = await getAuthService();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!appUrl) redirect("/auth/forgot-password?error=reset");
  const result = await auth.requestPasswordReset(email.data, `${appUrl}/auth/recover`);
  if (!result.ok) redirect(`/auth/forgot-password?error=${result.code === "RATE_LIMITED" ? "rate-limit" : "reset"}`);
  cookieJar.set("pi-recovery-sent-at", String(Date.now()), {
    httpOnly: true,
    maxAge: 5 * 60,
    path: "/auth",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  redirect("/auth/forgot-password?notice=check-email");
}

export async function updatePassword(formData: FormData) {
  const password = z.string().min(8).max(128).safeParse(formData.get("password"));
  if (!password.success) redirect("/auth/reset-password?error=invalid-input");

  const auth = await getAuthService();
  if (!await auth.currentUser()) redirect("/auth?error=invalid-confirmation");
  const result = await auth.updatePassword(password.data);
  if (!result.ok) redirect("/auth/reset-password?error=reset");
  redirect("/library");
}

export async function signOut() {
  const auth = await getAuthService();
  await auth.signOut();
  redirect("/");
}
