"use server";

import { redirect } from "next/navigation";
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
  redirect(result.user ? "/library" : "/auth?notice=check-email");
}

export async function signOut() {
  const auth = await getAuthService();
  await auth.signOut();
  redirect("/");
}
