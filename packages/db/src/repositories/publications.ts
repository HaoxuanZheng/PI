import { readPersonProfile, type ObjectSnapshot } from "@lifegraph/domain";
import {
  PublicationValidationError,
  projectObjectSnapshot,
  projectProfile,
  publishObjectInputSchema,
  publishProfileInputSchema,
  type PublicSnapshot,
  type PublishObjectInput,
  type PublishProfileInput
} from "@lifegraph/publications";
import { and, desc, eq, isNull, sql as statement } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { auditLogs, objectRevisions, objects, publications, users } from "../schema";
import { createPermissionRepository } from "./permissions";

export class PublicationNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export class PublicationStateError extends Error {
  readonly code = "PUBLICATION_STATE_CONFLICT";
}

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

export function createPublicationRepository(client: DatabaseClient) {
  const authorization = createPermissionRepository(client);

  async function loadSnapshot(transaction: Transaction, objectId: string) {
    const rows = await transaction
      .select({ object: objects, revision: objectRevisions })
      .from(objects)
      .innerJoin(objectRevisions, eq(objects.currentRevisionId, objectRevisions.id))
      .where(and(eq(objects.id, objectId), isNull(objects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function requireHandle(transaction: Transaction, ownerId: string) {
    const [user] = await transaction.select({ username: users.username }).from(users).where(eq(users.id, ownerId)).limit(1);
    if (!user) throw new PublicationNotFoundError();
    return user.username.toLowerCase();
  }

  /** Builds the projection for a profile publication without persisting it. */
  async function buildProfileSnapshot(transaction: Transaction, ownerId: string, input: PublishProfileInput, handle: string) {
    const sections = [];
    for (const section of input.sections) {
      const snapshots: ObjectSnapshot[] = [];
      for (const sourceObjectId of section.sourceObjectIds) {
        // Every referenced object is authorized individually; a profile cannot borrow access.
        await authorization.assert({ actorUserId: ownerId, action: "READ", resourceType: "OBJECT", resourceId: sourceObjectId });
        const loaded = await loadSnapshot(transaction, sourceObjectId);
        if (!loaded) throw new PublicationNotFoundError();
        if (loaded.object.ownerId !== ownerId) throw new PublicationValidationError("A profile may only publish your own objects");
        snapshots.push(loaded.revision.snapshot as ObjectSnapshot);
      }
      sections.push({ type: section.type, heading: section.heading, fields: section.fields, snapshots });
    }
    return projectProfile({ username: handle, displayName: input.displayName, headline: input.headline, sections });
  }

  return {
    /** Preview returns exactly the projection that publishing would store. */
    async previewObject(actorUserId: string, sourceObjectId: string, fields: readonly string[]) {
      await authorization.assert({ actorUserId, action: "READ", resourceType: "OBJECT", resourceId: sourceObjectId });
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const loaded = await loadSnapshot(transaction, sourceObjectId);
        if (!loaded) throw new PublicationNotFoundError();
        const snapshot = loaded.revision.snapshot as ObjectSnapshot;
        // A PERSON object carries contact detail, so publishing one is refused outright.
        if (readPersonProfile(snapshot)) throw new PublicationValidationError("A person record cannot be published");
        return {
          publicSnapshot: { kind: "OBJECT" as const, object: projectObjectSnapshot(snapshot, fields) },
          currentRevisionId: loaded.revision.id
        };
      });
    },

    async previewProfile(actorUserId: string, input: PublishProfileInput) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const handle = await requireHandle(transaction, actorUserId);
        return { publicSnapshot: { kind: input.publicationType, profile: await buildProfileSnapshot(transaction, actorUserId, input, handle) } };
      });
    },

    /**
     * Publishes one object as a projection frozen to a specific revision. Requires SHARE, an
     * explicit confirmation, and the caller's expected current revision, so a concurrent edit
     * cannot be published unseen.
     */
    async publishObject(actorUserId: string, input: PublishObjectInput, requestId?: string) {
      const parsed = publishObjectInputSchema.parse(input);
      await authorization.assert({ actorUserId, action: "SHARE", resourceType: "OBJECT", resourceId: parsed.sourceObjectId });

      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const handle = await requireHandle(transaction, actorUserId);
        const loaded = await loadSnapshot(transaction, parsed.sourceObjectId);
        if (!loaded) throw new PublicationNotFoundError();
        if (loaded.object.ownerId !== actorUserId) throw new PublicationValidationError("Only the owner may publish an object");
        if (loaded.revision.id !== parsed.expectedRevisionId) {
          throw new PublicationStateError("This object changed after the preview. Review it again before publishing.");
        }

        const snapshot = loaded.revision.snapshot as ObjectSnapshot;
        if (readPersonProfile(snapshot)) throw new PublicationValidationError("A person record cannot be published");
        const publicSnapshot: PublicSnapshot = { kind: "OBJECT", object: projectObjectSnapshot(snapshot, parsed.fields) };
        const now = new Date();

        const [row] = await transaction.insert(publications).values({
          ownerId: actorUserId,
          sourceObjectId: parsed.sourceObjectId,
          handle,
          slug: parsed.slug,
          publicationType: "OBJECT",
          publicSnapshot,
          publishedRevisionId: loaded.revision.id,
          status: "PUBLISHED",
          publishedAt: now,
          updatedAt: now,
          unpublishedAt: null
        }).onConflictDoUpdate({
          target: [publications.ownerId, publications.slug],
          set: {
            publicSnapshot,
            sourceObjectId: parsed.sourceObjectId,
            publishedRevisionId: loaded.revision.id,
            status: "PUBLISHED",
            publishedAt: now,
            updatedAt: now,
            unpublishedAt: null
          }
        }).returning();
        if (!row) throw new Error("Publication insert returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "OBJECT_PUBLISHED",
          resourceType: "OBJECT",
          resourceId: parsed.sourceObjectId,
          requestId,
          metadata: { publicationId: row.id, slug: row.slug, fields: parsed.fields.join(","), revisionId: loaded.revision.id }
        });
        return row;
      });
    },

    /** Publishes or replaces the caller's profile or professional view. */
    async publishProfile(actorUserId: string, input: PublishProfileInput, requestId?: string) {
      const parsed = publishProfileInputSchema.parse(input);
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const handle = await requireHandle(transaction, actorUserId);
        const profile = await buildProfileSnapshot(transaction, actorUserId, parsed, handle);
        const publicSnapshot: PublicSnapshot = parsed.publicationType === "PROFILE"
          ? { kind: "PROFILE", profile }
          : { kind: "PROFESSIONAL", profile };
        const slug = parsed.publicationType === "PROFILE" ? "profile" : "professional";
        const now = new Date();

        const [row] = await transaction.insert(publications).values({
          ownerId: actorUserId,
          sourceObjectId: null,
          handle,
          slug,
          publicationType: parsed.publicationType,
          publicSnapshot,
          publishedRevisionId: null,
          status: "PUBLISHED",
          publishedAt: now,
          updatedAt: now,
          unpublishedAt: null
        }).onConflictDoUpdate({
          target: [publications.ownerId, publications.slug],
          set: { publicSnapshot, status: "PUBLISHED", publishedAt: now, updatedAt: now, unpublishedAt: null }
        }).returning();
        if (!row) throw new Error("Profile publication insert returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "PROFILE_PUBLISHED",
          requestId,
          metadata: { publicationId: row.id, publicationType: parsed.publicationType, sections: parsed.sections.length }
        });
        return row;
      });
    },

    /** Unpublishing takes effect immediately: the public read path filters on PUBLISHED. */
    async unpublish(actorUserId: string, publicationId: string, requestId?: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const [existing] = await transaction.select().from(publications)
          .where(and(eq(publications.id, publicationId), eq(publications.ownerId, actorUserId)))
          .for("update")
          .limit(1);
        if (!existing) throw new PublicationNotFoundError();
        if (existing.status !== "PUBLISHED") throw new PublicationStateError("This publication is already unpublished");

        const now = new Date();
        const [row] = await transaction.update(publications)
          .set({ status: "UNPUBLISHED", unpublishedAt: now, publishedAt: null, updatedAt: now })
          .where(eq(publications.id, publicationId))
          .returning();
        if (!row) throw new Error("Unpublish returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId,
          actorType: "USER",
          action: "PUBLICATION_UNPUBLISHED",
          requestId,
          metadata: { publicationId, slug: existing.slug }
        });
        return row;
      });
    },

    async listMine(actorUserId: string, limit = 50) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        return transaction.select().from(publications)
          .where(eq(publications.ownerId, actorUserId))
          .orderBy(desc(publications.updatedAt))
          .limit(Math.min(Math.max(limit, 1), 100));
      });
    },

    /** Reports which of the caller's publications have drifted from their source's current revision. */
    async staleness(actorUserId: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, actorUserId);
        const rows = await transaction.select({
          id: publications.id,
          slug: publications.slug,
          publishedRevisionId: publications.publishedRevisionId,
          currentRevisionId: objects.currentRevisionId
        })
          .from(publications)
          .innerJoin(objects, eq(publications.sourceObjectId, objects.id))
          .where(and(eq(publications.ownerId, actorUserId), eq(publications.status, "PUBLISHED")));
        return rows.filter((row) => row.publishedRevisionId !== row.currentRevisionId);
      });
    }
  };
}

/**
 * The anonymous read path.
 *
 * This repository deliberately queries `publications` only. It never sets an owner context, never
 * joins `objects`, `object_revisions`, or `users`, and returns the stored projection verbatim, so an
 * anonymous request cannot reach a canonical record even if a projection were built incorrectly.
 */
export function createPublicReadRepository(client: DatabaseClient) {
  return {
    async profile(handle: string, publicationType: "PROFILE" | "PROFESSIONAL") {
      const rows = await client.db.select({
        handle: publications.handle,
        publicationType: publications.publicationType,
        publicSnapshot: publications.publicSnapshot,
        publishedAt: publications.publishedAt,
        updatedAt: publications.updatedAt
      })
        .from(publications)
        .where(and(
          eq(publications.handle, handle.toLowerCase()),
          eq(publications.publicationType, publicationType),
          eq(publications.status, "PUBLISHED")
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    async object(handle: string, slug: string) {
      const rows = await client.db.select({
        handle: publications.handle,
        slug: publications.slug,
        publicSnapshot: publications.publicSnapshot,
        publishedAt: publications.publishedAt,
        updatedAt: publications.updatedAt
      })
        .from(publications)
        .where(and(
          eq(publications.handle, handle.toLowerCase()),
          eq(publications.slug, slug.toLowerCase()),
          eq(publications.publicationType, "OBJECT"),
          eq(publications.status, "PUBLISHED")
        ))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Public object pages listed on a profile. */
    async objectsFor(handle: string, limit = 50) {
      return client.db.select({ slug: publications.slug, publicSnapshot: publications.publicSnapshot })
        .from(publications)
        .where(and(
          eq(publications.handle, handle.toLowerCase()),
          eq(publications.publicationType, "OBJECT"),
          eq(publications.status, "PUBLISHED")
        ))
        .orderBy(desc(publications.publishedAt))
        .limit(Math.min(Math.max(limit, 1), 100));
    }
  };
}
