import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export type DatabaseClient = {
  db: PostgresJsDatabase<typeof schema>;
  sql: Sql;
  close: () => Promise<void>;
};

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: async () => sql.end()
  };
}

export * from "./schema";
export * from "./repositories/objects";
export * from "./repositories/permissions";
export * from "./repositories/relationships";
export * from "./repositories/ai-operations";
export * from "./repositories/retrieval";
