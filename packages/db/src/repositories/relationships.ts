import type { CreateRelationshipInput } from "@lifegraph/domain";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { auditLogs, objectRelationships, objects } from "../schema";
import { createObjectRepository } from "./objects";
import { createPermissionRepository } from "./permissions";

export class RelationshipNotFoundError extends Error { readonly code = "NOT_FOUND"; }
export class RelationshipValidationError extends Error { readonly code = "VALIDATION_FAILED"; }

export function createRelationshipRepository(client: DatabaseClient) {
  const permissions = createPermissionRepository(client);
  const objectRepository = createObjectRepository(client);
  const context = (tx: Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0], id: string) => tx.execute(sql`select set_config('app.current_user_id', ${id}, true)`);
  return {
    async create(actorUserId: string, sourceObjectId: string, input: CreateRelationshipInput, requestId?: string) {
      if (sourceObjectId === input.targetObjectId) throw new RelationshipValidationError("An object cannot relate to itself");
      await permissions.assert({ actorUserId, action: "EDIT", resourceType: "OBJECT", resourceId: sourceObjectId });
      await permissions.assert({ actorUserId, action: "READ", resourceType: "OBJECT", resourceId: input.targetObjectId });
      return client.db.transaction(async (tx) => {
        await context(tx, actorUserId);
        const [source] = await tx.select({ ownerId: objects.ownerId }).from(objects).where(and(eq(objects.id, sourceObjectId), isNull(objects.deletedAt))).limit(1);
        if (!source) throw new RelationshipNotFoundError();
        const [existing] = await tx.select().from(objectRelationships).where(and(eq(objectRelationships.sourceObjectId, sourceObjectId), eq(objectRelationships.targetObjectId, input.targetObjectId), eq(objectRelationships.relationshipType, input.relationshipType), isNull(objectRelationships.deletedAt))).limit(1);
        if (existing) return existing;
        const [edge] = await tx.insert(objectRelationships).values({ ownerId: source.ownerId, sourceObjectId, targetObjectId: input.targetObjectId, relationshipType: input.relationshipType, label: input.label ?? null, createdByUserId: actorUserId }).returning();
        if (!edge) throw new Error("Relationship insert returned no row");
        await tx.insert(auditLogs).values({ actorUserId, actorType: "USER", action: "OBJECT_RELATIONSHIP_CREATED", resourceType: "OBJECT", resourceId: sourceObjectId, requestId, metadata: { relationshipId: edge.id, targetObjectId: edge.targetObjectId, relationshipType: edge.relationshipType } });
        return edge;
      });
    },
    async related(actorUserId: string, objectId: string) {
      await permissions.assert({ actorUserId, action: "READ", resourceType: "OBJECT", resourceId: objectId });
      const edges = await client.db.transaction(async (tx) => { await context(tx, actorUserId); return tx.select().from(objectRelationships).where(and(or(eq(objectRelationships.sourceObjectId, objectId), eq(objectRelationships.targetObjectId, objectId)), isNull(objectRelationships.deletedAt))).orderBy(desc(objectRelationships.createdAt)); });
      const visible = await Promise.all(edges.map(async (edge) => {
        const relatedObjectId = edge.sourceObjectId === objectId ? edge.targetObjectId : edge.sourceObjectId;
        try { return { edge, direction: edge.sourceObjectId === objectId ? "OUTGOING" as const : "INCOMING" as const, related: await objectRepository.get(actorUserId, relatedObjectId) }; } catch { return null; }
      }));
      return visible.filter((item): item is NonNullable<typeof item> => item !== null);
    },
    async remove(actorUserId: string, objectId: string, relationshipId: string, requestId?: string) {
      await permissions.assert({ actorUserId, action: "EDIT", resourceType: "OBJECT", resourceId: objectId });
      return client.db.transaction(async (tx) => {
        await context(tx, actorUserId);
        const [edge] = await tx.select().from(objectRelationships).where(and(eq(objectRelationships.id, relationshipId), eq(objectRelationships.sourceObjectId, objectId), isNull(objectRelationships.deletedAt))).for("update").limit(1);
        if (!edge) throw new RelationshipNotFoundError();
        const [removed] = await tx.update(objectRelationships).set({ deletedAt: new Date() }).where(and(eq(objectRelationships.id, relationshipId), isNull(objectRelationships.deletedAt))).returning();
        await tx.insert(auditLogs).values({ actorUserId, actorType: "USER", action: "OBJECT_RELATIONSHIP_REMOVED", resourceType: "OBJECT", resourceId: objectId, requestId, metadata: { relationshipId } });
        return removed;
      });
    }
  };
}
