import { readPersonProfile, type ObjectSnapshot } from "@lifegraph/domain";
import {
  findMergeCandidates,
  mergePersonProfiles,
  personSignals,
  type MergeDecision,
  type PersonRecord
} from "@lifegraph/entities";
import { and, desc, eq, isNull, sql as statement } from "drizzle-orm";
import type { DatabaseClient } from "../index";
import { auditLogs, entityMergeCandidates, entityMerges, objectRevisions, objects } from "../schema";
import { createPermissionRepository } from "./permissions";

export class MergeCandidateNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export class MergeCandidateStateError extends Error {
  readonly code = "MERGE_STATE_CONFLICT";
}

export class MergeNotApplicableError extends Error {
  readonly code = "VALIDATION_FAILED";
}

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

/** Bounds in-memory comparison. Beyond this a blocking index on email and phone keys is required. */
const MAX_COMPARED_PEOPLE = 2_000;

export function createEntityRepository(client: DatabaseClient) {
  const authorization = createPermissionRepository(client);

  async function loadPeople(transaction: Transaction) {
    const rows = await transaction
      .select({ objectId: objects.id, snapshot: objectRevisions.snapshot })
      .from(objects)
      .innerJoin(objectRevisions, eq(objects.currentRevisionId, objectRevisions.id))
      .where(and(eq(objects.type, "PERSON"), isNull(objects.deletedAt)))
      .orderBy(desc(objects.updatedAt))
      .limit(MAX_COMPARED_PEOPLE);

    const people: PersonRecord[] = [];
    for (const row of rows) {
      const snapshot = row.snapshot as ObjectSnapshot;
      const profile = readPersonProfile(snapshot);
      if (!profile) continue;
      const source = snapshot.customFields?.["source"] as { provider?: unknown; externalId?: unknown } | undefined;
      const provider = typeof source?.provider === "string" ? source.provider : null;
      const externalId = typeof source?.externalId === "string" ? source.externalId : null;
      people.push({
        objectId: row.objectId,
        signals: personSignals(profile, provider && externalId ? { provider, externalId } : null)
      });
    }
    return people;
  }

  return {
    /**
     * Recomputes duplicate proposals across the owner's people and records any new ones.
     *
     * A pair that already has a decision is never re-proposed, so a dismissal stays dismissed. Only
     * deterministic signals are used; nothing is merged here.
     */
    async detect(ownerId: string, requestId?: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const people = await loadPeople(transaction);

        const seen = new Set<string>();
        const proposals = [];
        for (const subject of people) {
          for (const candidate of findMergeCandidates(subject, people)) {
            const key = `${candidate.leftObjectId}:${candidate.rightObjectId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            proposals.push(candidate);
          }
        }

        let created = 0;
        for (const proposal of proposals) {
          const inserted = await transaction.insert(entityMergeCandidates).values({
            ownerId,
            leftObjectId: proposal.leftObjectId,
            rightObjectId: proposal.rightObjectId,
            score: proposal.match.score,
            confidence: proposal.match.confidence,
            signals: proposal.match.signals
          }).onConflictDoNothing({
            target: [entityMergeCandidates.ownerId, entityMergeCandidates.leftObjectId, entityMergeCandidates.rightObjectId]
          }).returning();
          if (inserted.length) created += 1;
        }

        if (created) {
          await transaction.insert(auditLogs).values({
            actorUserId: ownerId,
            actorType: "SYSTEM",
            action: "ENTITY_CANDIDATES_DETECTED",
            requestId,
            metadata: { created, compared: people.length }
          });
        }

        return { compared: people.length, proposed: proposals.length, created, truncated: people.length >= MAX_COMPARED_PEOPLE };
      });
    },

    async listCandidates(ownerId: string, limit = 50) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        return transaction.select().from(entityMergeCandidates)
          .where(and(eq(entityMergeCandidates.ownerId, ownerId), eq(entityMergeCandidates.status, "PENDING")))
          .orderBy(desc(entityMergeCandidates.score), desc(entityMergeCandidates.createdAt))
          .limit(Math.min(Math.max(limit, 1), 100));
      });
    },

    /** Records "keep separate" so the pair is never proposed again. */
    async separate(ownerId: string, candidateId: string, requestId?: string) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [candidate] = await transaction.select().from(entityMergeCandidates)
          .where(and(eq(entityMergeCandidates.id, candidateId), eq(entityMergeCandidates.ownerId, ownerId)))
          .for("update")
          .limit(1);
        if (!candidate) throw new MergeCandidateNotFoundError();
        if (candidate.status !== "PENDING") throw new MergeCandidateStateError("This candidate was already decided");

        const [updated] = await transaction.update(entityMergeCandidates)
          .set({ status: "SEPARATE", decidedAt: new Date() })
          .where(eq(entityMergeCandidates.id, candidateId))
          .returning();
        if (!updated) throw new Error("Candidate update returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "ENTITY_KEPT_SEPARATE",
          resourceType: "OBJECT",
          resourceId: candidate.leftObjectId,
          requestId,
          metadata: { candidateId, otherObjectId: candidate.rightObjectId }
        });
        return updated;
      });
    },

    /**
     * Applies a reviewed merge. The target absorbs the source's contact detail as a new revision,
     * and the source is soft-deleted with its own revision, so neither side loses history. The
     * revisions on both sides are recorded, making every merge auditable.
     */
    async merge(ownerId: string, candidateId: string, targetObjectId: string, requestId?: string) {
      const [candidate] = await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        return transaction.select().from(entityMergeCandidates)
          .where(and(eq(entityMergeCandidates.id, candidateId), eq(entityMergeCandidates.ownerId, ownerId)))
          .limit(1);
      });
      if (!candidate) throw new MergeCandidateNotFoundError();
      if (candidate.status !== "PENDING") throw new MergeCandidateStateError("This candidate was already decided");
      if (targetObjectId !== candidate.leftObjectId && targetObjectId !== candidate.rightObjectId) {
        throw new MergeNotApplicableError("The merge target must be one of the candidate's two objects");
      }
      const sourceObjectId = targetObjectId === candidate.leftObjectId ? candidate.rightObjectId : candidate.leftObjectId;

      // Both sides are edited, so both require EDIT through the permission engine.
      await authorization.assert({ actorUserId: ownerId, action: "EDIT", resourceType: "OBJECT", resourceId: targetObjectId });
      await authorization.assert({ actorUserId: ownerId, action: "EDIT", resourceType: "OBJECT", resourceId: sourceObjectId });

      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        // Lock in a deterministic order so two concurrent merges cannot deadlock.
        for (const lockId of [targetObjectId, sourceObjectId].sort()) {
          await transaction.select({ id: objects.id }).from(objects).where(eq(objects.id, lockId)).for("update").limit(1);
        }

        const load = async (objectId: string) => {
          const rows = await transaction
            .select({ object: objects, revision: objectRevisions })
            .from(objects)
            .innerJoin(objectRevisions, eq(objects.currentRevisionId, objectRevisions.id))
            .where(and(eq(objects.id, objectId), isNull(objects.deletedAt)))
            .limit(1);
          return rows[0] ?? null;
        };

        const target = await load(targetObjectId);
        const source = await load(sourceObjectId);
        if (!target || !source) throw new MergeCandidateStateError("One of these people no longer exists");

        const targetProfile = readPersonProfile(target.revision.snapshot as ObjectSnapshot);
        const sourceProfile = readPersonProfile(source.revision.snapshot as ObjectSnapshot);
        if (!targetProfile || !sourceProfile) throw new MergeNotApplicableError("Both objects must be people with contact detail");

        const targetSnapshot = target.revision.snapshot as ObjectSnapshot;
        const mergedSnapshot: ObjectSnapshot = {
          ...targetSnapshot,
          customFields: {
            ...targetSnapshot.customFields,
            person: mergePersonProfiles(targetProfile, sourceProfile)
          }
        };

        const [targetRevision] = await transaction.insert(objectRevisions).values({
          objectId: targetObjectId,
          previousRevisionId: target.revision.id,
          snapshot: mergedSnapshot,
          changeType: "UPDATE",
          createdByType: "USER",
          createdByUserId: ownerId
        }).returning();
        if (!targetRevision) throw new Error("Merge target revision insert returned no row");

        await transaction.update(objects)
          .set({ currentRevisionId: targetRevision.id, updatedAt: targetRevision.createdAt })
          .where(eq(objects.id, targetObjectId));

        const [sourceRevision] = await transaction.insert(objectRevisions).values({
          objectId: sourceObjectId,
          previousRevisionId: source.revision.id,
          snapshot: source.revision.snapshot as ObjectSnapshot,
          changeType: "DELETE",
          createdByType: "USER",
          createdByUserId: ownerId
        }).returning();
        if (!sourceRevision) throw new Error("Merge source revision insert returned no row");

        const deletedAt = new Date();
        await transaction.update(objects)
          .set({ currentRevisionId: sourceRevision.id, deletedAt, updatedAt: deletedAt })
          .where(eq(objects.id, sourceObjectId));

        await transaction.update(entityMergeCandidates)
          .set({ status: "MERGED", decidedAt: deletedAt })
          .where(eq(entityMergeCandidates.id, candidateId));

        const [record] = await transaction.insert(entityMerges).values({
          ownerId,
          candidateId,
          targetObjectId,
          sourceObjectId,
          targetRevisionBefore: target.revision.id,
          targetRevisionAfter: targetRevision.id,
          sourceRevisionBefore: source.revision.id
        }).returning();
        if (!record) throw new Error("Merge record insert returned no row");

        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "ENTITY_MERGED",
          resourceType: "OBJECT",
          resourceId: targetObjectId,
          requestId,
          metadata: { candidateId, sourceObjectId, targetRevisionAfter: targetRevision.id }
        });

        return { merge: record, targetRevisionId: targetRevision.id };
      });
    },

    async decide(ownerId: string, candidateId: string, decision: MergeDecision, targetObjectId: string | null, requestId?: string) {
      if (decision === "SEPARATE") return { decision, candidate: await this.separate(ownerId, candidateId, requestId) };
      if (!targetObjectId) throw new MergeNotApplicableError("A merge requires a target object");
      return { decision, merge: await this.merge(ownerId, candidateId, targetObjectId, requestId) };
    },

    async listMerges(ownerId: string, limit = 50) {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        return transaction.select().from(entityMerges)
          .where(eq(entityMerges.ownerId, ownerId))
          .orderBy(desc(entityMerges.createdAt))
          .limit(Math.min(Math.max(limit, 1), 100));
      });
    }
  };
}
