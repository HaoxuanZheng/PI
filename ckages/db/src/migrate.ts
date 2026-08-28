import { migrate } from "drizzle-orm/postgres-js/migrator";
import { parseServerEnv } from "@lifegraph/config";
import { createDatabaseClient } from "./index";

const env = parseServerEnv(process.env);
const client = createDatabaseClient(env.DATABASE_URL);

try {
  await migrate(client.db, { migrationsFolder: "./migrations" });
} finally {
  await client.close();
}
