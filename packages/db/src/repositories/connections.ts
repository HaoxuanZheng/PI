import { and, eq, sql as statement } from "drizzle-orm";
import {
  ConnectionCryptoError,
  connectionStatusOf,
  expiryFromNow,
  openToken,
  parseTokenKey,
  sealToken,
  type ConnectInput,
  type ConnectionProvider,
  type ConnectionStatus,
  type SealedToken
} from "@lifegraph/connections";
import type { DatabaseClient } from "../index";
import { auditLogs, providerConnections, users } from "../schema";

export class ConnectionNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export type ConnectionSummary = {
  provider: ConnectionProvider;
  status: ConnectionStatus;
  scopes: string[];
  expiresAt: string | null;
  updatedAt: string;
};

export type LiveToken = {
  provider: ConnectionProvider;
  accessToken: string;
};

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0];

async function setOwnerContext(transaction: Transaction, ownerId: string) {
  await transaction.execute(statement`select set_config('app.current_user_id', ${ownerId}, true)`);
}

function tokenKey() {
  return parseTokenKey(process.env.OAUTH_TOKEN_KEY);
}

function toSummary(row: typeof providerConnections.$inferSelect): ConnectionSummary {
  return {
    provider: row.provider as ConnectionProvider,
    status: connectionStatusOf(row.expiresAt),
    scopes: row.scopes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString()
  };
}

export function createConnectionRepository(client: DatabaseClient) {
  return {
    /**
     * Stores or replaces a user's provider token. Plaintext touches memory
     * only: the row carries AES-GCM sealed blobs, and no read path below
     * ever returns token material, only status.
     */
    async connect(ownerId: string, input: ConnectInput, requestId?: string): Promise<ConnectionSummary> {
      const key = tokenKey();
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [user] = await transaction.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
        if (!user) throw new ConnectionNotFoundError();
        const sealedAccess = sealToken(key, input.accessToken);
        const sealedRefresh = input.refreshToken ? sealToken(key, input.refreshToken) : null;
        const now = new Date();
        const [row] = await transaction.insert(providerConnections).values({
          userId: ownerId,
          provider: input.provider,
          sealedAccessToken: sealedAccess,
          sealedRefreshToken: sealedRefresh,
          scopes: input.scopes,
          expiresAt: expiryFromNow(input.expiresInSeconds),
          updatedAt: now
        }).onConflictDoUpdate({
          target: [providerConnections.userId, providerConnections.provider],
          set: {
            sealedAccessToken: sealedAccess,
            sealedRefreshToken: sealedRefresh,
            scopes: input.scopes,
            expiresAt: expiryFromNow(input.expiresInSeconds),
            updatedAt: now
          }
        }).returning();
        if (!row) throw new Error("Connection upsert returned no row");
        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "PROVIDER_CONNECTED",
          resourceType: "ACCOUNT",
          resourceId: ownerId,
          requestId,
          metadata: { provider: input.provider, scopeCount: input.scopes.length }
        });
        return toSummary(row);
      });
    },

    async status(ownerId: string): Promise<ConnectionSummary[]> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const rows = await transaction.select().from(providerConnections)
          .where(eq(providerConnections.userId, ownerId));
        return rows.map(toSummary);
      });
    },

    /** Removes the stored token. Importers fall back to operator tokens. */
    async disconnect(ownerId: string, provider: ConnectionProvider, requestId?: string): Promise<void> {
      await client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const deleted = await transaction.delete(providerConnections).where(
          eq(providerConnections.provider, provider)
        ).returning({ id: providerConnections.id });
        if (!deleted.length) throw new ConnectionNotFoundError();
        await transaction.insert(auditLogs).values({
          actorUserId: ownerId,
          actorType: "USER",
          action: "PROVIDER_DISCONNECTED",
          resourceType: "ACCOUNT",
          resourceId: ownerId,
          requestId,
          metadata: { provider }
        });
      });
    },

    /**
     * Opens a live token for server-side import work. Throws when absent or
     * expired so callers fall back explicitly rather than sending dead tokens.
     */
    async liveToken(ownerId: string, provider: ConnectionProvider): Promise<LiveToken> {
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(providerConnections).where(
          and(eq(providerConnections.userId, ownerId), eq(providerConnections.provider, provider))
        ).limit(1);
        if (!row) throw new ConnectionNotFoundError();
        if (connectionStatusOf(row.expiresAt) !== "connected") {
          throw new ConnectionNotFoundError();
        }
        let key: Buffer;
        try {
          key = tokenKey();
        } catch {
          throw new ConnectionCryptoError("Token encryption is not configured");
        }
        return { provider, accessToken: openToken(key, row.sealedAccessToken as SealedToken) };
      });
    }
  };
}
