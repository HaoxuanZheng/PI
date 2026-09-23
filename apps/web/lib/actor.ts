import type { AuthUser } from "@lifegraph/auth";
import { getObjectRepository } from "./db";

export class InactiveAccountError extends Error {}

export async function provisionActor(actor: AuthUser) {
  const username = `user-${actor.id.replaceAll("-", "").slice(0, 12)}`;
  const profile = await getObjectRepository().provisionUser({ id: actor.id, username, email: actor.email });
  if (!profile || profile.accountStatus !== "ACTIVE") throw new InactiveAccountError("The account is not active");
  return actor;
}

/**
 * Deletion status and cancellation must remain reachable inside the recovery
 * window: DELETION_PENDING fails ordinary provisioning by design, so account
 * routes explicitly allow it while every other route stays blocked.
 */
export async function provisionActorAllowingPendingDeletion(actor: AuthUser) {
  const username = `user-${actor.id.replaceAll("-", "").slice(0, 12)}`;
  const profile = await getObjectRepository().provisionUser({ id: actor.id, username, email: actor.email });
  if (!profile || (profile.accountStatus !== "ACTIVE" && profile.accountStatus !== "DELETION_PENDING")) {
    throw new InactiveAccountError("The account is not active");
  }
  return actor;
}
