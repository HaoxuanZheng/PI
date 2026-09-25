import { and, eq, sql as statement } from "drizzle-orm";
import {
  ConnectionCryptoError,
  connectionStatusOf,
  expiryFromNow,
  isGoogleProvider,
  openToken,
  parseTokenKey,
  refreshGoogleToken,
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
  try {
    return parseTokenKey(process.env.OAUTH_TOKEN_KEY);
  } catch {
    throw new ConnectionCryptoError("Token encryption is not configured");
  }
}

function googleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function tryRefresh(
  key: Buffer,
  sealedRefresh: SealedToken | null,
  provider: ConnectionProvider
): Promise<{ accessToken: string; refreshToken: string | null; expiresInSeconds: number } | null> {
  if (!sealedRefresh || !isGoogleProvider(provider)) return null;
  const creds = googleCredentials();
  if (!creds) return null;
  try {
    const rotated = await refreshGoogleToken({
      ...creds,
      refreshToken: openToken(key, sealedRefresh)
    });
    return {
      accessToken: rotated.access_token,
      refreshToken: rotated.refresh_token ?? null,
      expiresInSeconds: rotated.expires_in
    };
  } catch {
    return null;
  }
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
     * Opens a live token for server-side import work. Expired Google rows
     * refresh transparently when a refresh token and OAuth credentials are
     * configured; anything unusable throws so callers fall back explicitly
     * rather than sending dead tokens. Refresh failures degrade to the same
     * absence: the operator-token fallback keeps imports working.
     */
    async liveToken(ownerId: string, provider: ConnectionProvider): Promise<LiveToken> {
      const key = tokenKey();
      return client.db.transaction(async (transaction) => {
        await setOwnerContext(transaction, ownerId);
        const [row] = await transaction.select().from(providerConnections).where(
          and(eq(providerConnections.userId, ownerId), eq(providerConnections.provider, provider))
        ).limit(1);
        if (!row) throw new ConnectionNotFoundError();
        if (connectionStatusOf(row.expiresAt) === "connected") {
          return { provider, accessToken: openToken(key, row.sealedAccessToken as SealedToken) };
        }
        const refreshed = await tryRefresh(key, row.sealedRefreshToken as SealedToken | null, provider);
        if (!refreshed) throw new ConnectionNotFoundError();
        const now = new Date();
        await transaction.update(providerConnections).set({
          sealedAccessToken: sealToken(key, refreshed.accessToken),
          sealedRefreshToken: refreshed.refreshToken ? sealToken(key, refreshed.refreshToken) : row.sealedRefreshToken,
          expiresAt: expiryFromNow(refreshed.expiresInSeconds),
          updatedAt: now
        }).where(
          and(eq(providerConnections.userId, ownerId), eq(providerConnections.provider, provider))
        );
        return { provider, accessToken: refreshed.accessToken };
      });
    }
  };
}
