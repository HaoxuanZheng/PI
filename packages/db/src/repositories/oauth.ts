import { randomBytes } from "node:crypto";
import { and, eq, sql as statement } from "drizzle-orm";
import type { ConnectionProvider } from "@lifegraph/connections";
import type { DatabaseClient } from "../index";
import { oauthStates } from "../schema";

export class OAuthStateError extends Error {
  readonly code = "OAUTH_STATE_CONFLICT";
}

/** States live 10 minutes: enough to click through consent, nothing more. */
export const oauthStateTtlMinutes = 10;

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

export function createOAuthStateRepository(client: DatabaseClient) {
  return {
    /** Binds a fresh single-use state to the user starting the dance. */
    async create(ownerId: string, provider: ConnectionProvider): Promise<string> {
      const state = randomBytes(32).toString("hex");
      await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        await transaction.insert(oauthStates).values({
          state,
          userId: ownerId,
          provider,
          expiresAt: new Date(Date.now() + oauthStateTtlMinutes * 60_000)
        });
      });
      return state;
    },

    /**
     * Consumes a state exactly once for its owning user. Expired, unknown,
     * or foreign-user states fail closed so replays and login-CSRF dances
     * can never mint tokens.
     */
    async consume(ownerId: string, state: string): Promise<ConnectionProvider> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(oauthStates)
          .where(and(eq(oauthStates.userId, ownerId), eq(oauthStates.state, state)))
          .limit(1);
        if (!row) throw new OAuthStateError("Unknown or foreign authorization state");
        await transaction.delete(oauthStates).where(eq(oauthStates.state, state));
        if (row.expiresAt.getTime() <= Date.now()) throw new OAuthStateError("Authorization state expired");
        return row.provider as ConnectionProvider;
      });
    }
  };
}
