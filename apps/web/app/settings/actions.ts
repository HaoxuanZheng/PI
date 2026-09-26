"use server";

import { redirect } from "next/navigation";
import { getAuthService } from "@/lib/auth";
import { provisionActor } from "@/lib/actor";
import { getAISettingsRepository } from "@/lib/db";

export async function saveAISettings(formData: FormData) {
  const user = await (await getAuthService()).currentUser();
  if (!user) redirect("/auth");
  const actor = await provisionActor(user);
  await getAISettingsRepository().save(actor.id, {
    apiKey: String(formData.get("apiKey") ?? ""),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    chatModel: String(formData.get("chatModel") ?? ""),
    embeddingModel: String(formData.get("embeddingModel") ?? "")
  });
  redirect("/settings?saved=1");
}

export async function removeAISettings() {
  const user = await (await getAuthService()).currentUser();
  if (!user) redirect("/auth");
  const actor = await provisionActor(user);
  await getAISettingsRepository().remove(actor.id);
  redirect("/settings?removed=1");
}
