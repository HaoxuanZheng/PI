import { parseServerEnv } from "@lifegraph/config";
import { createAIOperationRepository, createDatabaseClient, createEntityRepository, createFileRepository, createImportRepository, createPublicReadRepository, createPublicationRepository, createObjectRepository, createPermissionRepository, createRelationshipRepository, createRetrievalRepository, type DatabaseClient } from "@lifegraph/db";
import { getStoragePort, storageRequiresCleanScan } from "./storage";

const globalDatabase = globalThis as typeof globalThis & { lifeGraphDatabase?: DatabaseClient };

export function getDatabaseClient() {
  if (!globalDatabase.lifeGraphDatabase) {
    const env = parseServerEnv(process.env);
    globalDatabase.lifeGraphDatabase = createDatabaseClient(env.DATABASE_URL);
  }
  return globalDatabase.lifeGraphDatabase;
}

export function getObjectRepository() {
  return createObjectRepository(getDatabaseClient());
}

export function getPermissionRepository() {
  return createPermissionRepository(getDatabaseClient());
}
export function getRelationshipRepository() { return createRelationshipRepository(getDatabaseClient()); }
export function getAIOperationRepository() { return createAIOperationRepository(getDatabaseClient()); }
export function getRetrievalRepository(){return createRetrievalRepository(getDatabaseClient());}
export function getPublicationRepository() { return createPublicationRepository(getDatabaseClient()); }
/** Anonymous read path: publications only, no owner context. */
export function getPublicReadRepository() { return createPublicReadRepository(getDatabaseClient()); }
export function getEntityRepository() { return createEntityRepository(getDatabaseClient()); }
export function getImportRepository() { return createImportRepository(getDatabaseClient()); }
export function getFileRepository() { return createFileRepository(getDatabaseClient(), getStoragePort(), { requireCleanScan: storageRequiresCleanScan() }); }
