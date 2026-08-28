import { parseServerEnv } from "@lifegraph/config";
import { createDatabaseClient, createObjectRepository, createPermissionRepository, createRelationshipRepository, type DatabaseClient } from "@lifegraph/db";

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
