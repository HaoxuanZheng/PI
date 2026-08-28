import type { GrantPermissionInput, Capability, PermissionDecision, ResourceType } from "@lifegraph/permissions";
import { decidePermission } from "@lifegraph/permissions";
import { and, desc, eq, isNull, sql as statement } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { auditLogs, objects, permissionGrants } from "../schema";

export class PermissionDeniedError extends Error {
  readonly code = "FORBIDDEN";
}

export class PermissionNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export function createPermissionRepository(client: DatabaseClient) {
  async function can(input: {
    actorUserId: string;
    action: Capability;
    resourceType: ResourceType;
    resourceId: string;
  }): Promise<PermissionDecision> {
    return client.db.transaction(async (transaction) => {
      await transaction.execute(statement`select set_config('app.current_user_id', ${input.actorUserId}, true)`);
      const [resource] = await transaction.select({ ownerId: objects.ownerId }).from(objects)
        .where(and(eq(objects.id, input.resourceId), isNull(objects.deletedAt)))
        .limit(1);
      if (!resource) return { allowed: false, reason: "DENIED", fieldPolicy: { default: "PRIVATE", fields: {} } };

      const grants = await transaction.select({
        principalType: permissionGrants.principalType,
        principalId: permissionGrants.principalId,
        capability: permissionGrants.capability
      }).from(permissionGrants).where(and(
        eq(permissionGrants.resourceType, input.resourceType),
        eq(permissionGrants.resourceId, input.resourceId),
        isNull(permissionGrants.revokedAt)
      ));
      return decidePermission({ actorUserId: input.actorUserId, action: input.action, resourceOwnerId: resource.ownerId, grants });
    });
  }

  async function assert(input: {
    actorUserId: string;
    action: Capability;
    resourceType: ResourceType;
    resourceId: string;
  }) {
    const decision = await can(input);
    if (!decision.allowed) throw new PermissionDeniedError("The requested capability is not granted");
    return decision;
  }

  async function assertOwner(actorUserId: string, resourceId: string) {
    return client.db.transaction(async (transaction) => {
      await transaction.execute(statement`select set_config('app.current_user_id', ${actorUserId}, true)`);
      const [resource] = await transaction.select({ ownerId: objects.ownerId }).from(objects)
        .where(and(eq(objects.id, resourceId), isNull(objects.deletedAt))).limit(1);
      if (!resource || resource.ownerId !== actorUserId) throw new PermissionDeniedError("Only the owner may manage grants");
      return resource;
    });
  }

  return {
    can,
    assert,

    async list(actorUserId: string, resourceId: string) {
      await assertOwner(actorUserId, resourceId);
      return client.db.transaction(async (transaction) => {
        await transaction.execute(statement`select set_config('app.current_user_id', ${actorUserId}, true)`);
        return transaction.select().from(permissionGrants).where(and(
          eq(permissionGrants.resourceType, "OBJECT"),
          eq(permissionGrants.resourceId, resourceId),
          isNull(permissionGrants.revokedAt)
        )).orderBy(desc(permissionGrants.createdAt));
      });
    },

    async grant(actorUserId: string, resourceId: string, input: GrantPermissionInput, requestId?: string) {
      await assertOwner(actorUserId, resourceId);
      return client.db.transaction(async (transaction) => {
        await transaction.execute(statement`select set_config('app.current_user_id', ${actorUserId}, true)`);
        const [resource] = await transaction.select({ ownerId: objects.ownerId }).from(objects)
          .where(and(eq(objects.id, resourceId), isNull(objects.deletedAt))).limit(1);
        if (!resource) throw new PermissionNotFoundError();

        const [existing] = await transaction.select().from(permissionGrants).where(and(
          eq(permissionGrants.resourceType, "OBJECT"),
          eq(permissionGrants.resourceId, resourceId),
          eq(permissionGrants.principalType, input.principalType),
          input.principalId === null ? isNull(permissionGrants.principalId) : eq(permissionGrants.principalId, input.principalId),
          eq(permissionGrants.capability, input.capability),
          isNull(permissionGrants.revokedAt)
        )).limit(1);
        if (existing) return existing;

        const [grant] = await transaction.insert(permissionGrants).values({
          ownerId: resource.ownerId,
          resourceType: "OBJECT",
          resourceId,
          principalType: input.principalType,
          principalId: input.principalId,
          capability: input.capability
        }).returning();
        if (!grant) throw new Error("Permission insert returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "PERMISSION_GRANTED",
          resourceType: "OBJECT",
          resourceId,
          requestId,
          metadata: { permissionId: grant.id, principalType: grant.principalType, capability: grant.capability }
        });
        return grant;
      });
    },

    async revoke(actorUserId: string, resourceId: string, permissionId: string, requestId?: string) {
      await assertOwner(actorUserId, resourceId);
      return client.db.transaction(async (transaction) => {
        await transaction.execute(statement`select set_config('app.current_user_id', ${actorUserId}, true)`);
        const [grant] = await transaction.select().from(permissionGrants).where(and(
          eq(permissionGrants.id, permissionId),
          eq(permissionGrants.resourceType, "OBJECT"),
          eq(permissionGrants.resourceId, resourceId),
          isNull(permissionGrants.revokedAt)
        )).for("update").limit(1);
        if (!grant) throw new PermissionNotFoundError();

        const [revoked] = await transaction.update(permissionGrants).set({ revokedAt: new Date() })
          .where(and(eq(permissionGrants.id, permissionId), isNull(permissionGrants.revokedAt))).returning();
        if (!revoked) throw new PermissionNotFoundError();

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "PERMISSION_REVOKED",
          resourceType: "OBJECT",
          resourceId,
          requestId,
          metadata: { permissionId: grant.id, principalType: grant.principalType, capability: grant.capability }
        });
        return revoked;
      });
    },

    async audit(actorUserId: string, resourceId: string) {
      await assertOwner(actorUserId, resourceId);
      return client.db.transaction(async (transaction) => {
        await transaction.execute(statement`select set_config('app.current_user_id', ${actorUserId}, true)`);
        return transaction.select().from(auditLogs).where(and(
          eq(auditLogs.resourceType, "OBJECT"),
          eq(auditLogs.resourceId, resourceId)
        )).orderBy(desc(auditLogs.createdAt));
      });
    }
  };
}
