"use server";

import { createObjectInputSchema, createRelationshipInputSchema, restoreRevisionInputSchema } from "@lifegraph/domain";
import { onboardingGoalSchema } from "@lifegraph/analytics";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { provisionActor } from "@/lib/actor";
import { getAuthService } from "@/lib/auth";
import { getObjectRepository, getOnboardingRepository, getRelationshipRepository } from "@/lib/db";

const noteFormSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().max(100_000)
});

async function actorId() {
  const user = await (await getAuthService()).currentUser();
  if (!user) redirect("/auth");
  return (await provisionActor(user)).id;
}

export async function createNote(formData: FormData) {
  const form = noteFormSchema.safeParse({ title: formData.get("title"), content: formData.get("content") });
  if (!form.success) redirect("/library?error=invalid-note");
  const input = createObjectInputSchema.parse({
    snapshot: {
      schemaVersion: 1,
      type: "NOTE",
      title: form.data.title,
      body: { format: "richtext", content: [{ id: crypto.randomUUID(), type: "paragraph", text: form.data.content }] },
      tags: [],
      customFields: {}
    }
  });
  const created = await getObjectRepository().create(await actorId(), input);
  redirect(`/library/${created.object.id}`);
}

export async function restoreRevision(formData: FormData) {
  const objectId = z.uuid().parse(formData.get("objectId"));
  const input = restoreRevisionInputSchema.parse({
    revisionId: formData.get("revisionId"),
    expectedRevisionId: formData.get("expectedRevisionId")
  });
  await getObjectRepository().restore(await actorId(), objectId, input);
  revalidatePath(`/library/${objectId}`);
}

export async function createRelationship(formData: FormData) {
  const objectId = z.uuid().parse(formData.get("objectId"));
  const input = createRelationshipInputSchema.parse({ targetObjectId: formData.get("targetObjectId"), relationshipType: formData.get("relationshipType"), label: formData.get("label") || null });
  await getRelationshipRepository().create(await actorId(), objectId, input);
  revalidatePath(`/library/${objectId}`);
}

export async function removeRelationship(formData: FormData) {
  const objectId = z.uuid().parse(formData.get("objectId"));
  await getRelationshipRepository().remove(await actorId(), objectId, z.uuid().parse(formData.get("relationshipId")));
  revalidatePath(`/library/${objectId}`);
}

export async function startOnboarding() {
  await getOnboardingRepository().update(await actorId(), { action: "start" });
  revalidatePath("/library");
}

export async function selectOnboardingGoal(formData: FormData) {
  const goal = onboardingGoalSchema.parse(formData.get("goal"));
  const id = await actorId();
  const repository = getOnboardingRepository();
  try {
    await repository.update(id, { action: "start" });
  } catch {
    // Already started: goal selection is the actual intent.
  }
  await repository.update(id, { action: "select-goal", goal });
  revalidatePath("/library");
}

export async function completeOnboarding() {
  await getOnboardingRepository().update(await actorId(), { action: "complete" });
  revalidatePath("/library");
}
