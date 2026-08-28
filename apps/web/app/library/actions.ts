"use server";

import { createObjectInputSchema, restoreRevisionInputSchema } from "@lifegraph/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { provisionActor } from "@/lib/actor";
import { getAuthService } from "@/lib/auth";
import { getObjectRepository } from "@/lib/db";

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
