import type { AuthUser } from "@lifegraph/auth";
import { getObjectRepository } from "./db";

export class InactiveAccountError extends Error {}

export async function provisionActor(actor: AuthUser) {
  const username = `user-${actor.id.replaceAll("-", "").slice(0, 12)}`;
  const profile = await getObjectRepository().provisionUser({ id: actor.id, username, email: actor.email });
  if (!profile || profile.accountStatus !== "ACTIVE") throw new InactiveAccountError("The account is not active");
  return actor;
}
