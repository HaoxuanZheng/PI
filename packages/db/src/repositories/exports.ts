import { eq, inArray, sql as statement } from "drizzle-orm";
import {
  assertBundleOwnership,
  emptyCollections,
  exportBundleVersion,
  type ExportBundle,
  type ExportFormat
} from "@lifegraph/privacy";
import type { DatabaseClient } from "../index";
import { AccountNotFoundError } from "./accounts";
import {
  aiOperations,
  auditLogs,
  entityMergeCandidates,
  entityMerges,
  files,
  imports,
  objectRelationships,
  objectRevisions,
  objects,
  permissionGrants,
  publications,
  users
} from "../schema";

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

export function createExportRepository(client: DatabaseClient) {
  return {
    /**
     * Assembles the full user-owned bundle in one transaction.
     *
     * Soft-deleted rows are included so the export is a complete history
     * rather than a filtered view: a user who deleted an object still owns
     * that history. Derived embeddings are excluded (they are reproducible
     * from revisions), and audit events carry metadata only, never bodies.
     */
    async exportBundle(ownerId: string, requestId?: string): Promise<ExportBundle> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [user] = await transaction.select().from(users).where(eq(users.id, ownerId)).limit(1);
        if (!user) throw new AccountNotFoundError();

        const ownedObjects = await transaction.select().from(objects).where(eq(objects.ownerId, ownerId));
        const objectIds = ownedObjects.map((row) => row.id);
        const revisions = objectIds.length
          ? await transaction.select().from(objectRevisions).where(inArray(objectRevisions.objectId, objectIds))
          : [];

        const [relationships, fileRows, publicationRows, importRows, aiRows, candidates, merges, grants, audits] =
          await Promise.all([
            transaction.select().from(objectRelationships).where(eq(objectRelationships.ownerId, ownerId)),
            transaction.select().from(files).where(eq(files.ownerId, ownerId)),
            transaction.select().from(publications).where(eq(publications.ownerId, ownerId)),
            transaction.select().from(imports).where(eq(imports.userId, ownerId)),
            transaction.select().from(aiOperations).where(eq(aiOperations.userId, ownerId)),
            transaction.select().from(entityMergeCandidates).where(eq(entityMergeCandidates.ownerId, ownerId)),
            transaction.select().from(entityMerges).where(eq(entityMerges.ownerId, ownerId)),
            transaction.select().from(permissionGrants).where(eq(permissionGrants.ownerId, ownerId)),
            transaction.select().from(auditLogs).where(eq(auditLogs.actorUserId, ownerId))
          ]);

        const collections = emptyCollections();
        collections.objects = ownedObjects;
        collections.revisions = revisions;
        collections.relationships = relationships;
        collections.files = fileRows;
        collections.publications = publicationRows;
        collections.imports = importRows;
        collections.aiOperations = aiRows;
        collections.mergeCandidates = candidates;
        collections.merges = merges;
        collections.grantsIssued = grants;
        collections.auditEvents = audits;

        const bundle: ExportBundle = {
          bundleVersion: exportBundleVersion,
          exportedAt: new Date().toISOString(),
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            timezone: user.timezone,
            locale: user.locale,
            accountStatus: user.accountStatus,
            createdAt: user.createdAt.toISOString()
          },
          collections
        };

        // Final guard: the one endpoint returning a large slice of the database
        // is checked rather than trusted.
        assertBundleOwnership(bundle, ownerId);

        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "ACCOUNT_EXPORTED",
          resourceType: "ACCOUNT",
          resourceId: ownerId,
          requestId,
          metadata: {
            bundleVersion: exportBundleVersion,
            objectCount: ownedObjects.length,
            revisionCount: revisions.length
          }
        });

        return bundle;
      });
    }
  };
}

export type { ExportFormat };
