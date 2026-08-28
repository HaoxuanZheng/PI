import { parseServerEnv } from "@lifegraph/config";
import { createDatabaseClient, createObjectRepository, type DatabaseClient } from "@lifegraph/db";

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
