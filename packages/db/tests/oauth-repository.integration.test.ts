import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseClient } from "../src/index";
import { ConnectionNotFoundError, createConnectionRepository } from "../src/repositories/connections";
import { OAuthStateError, createOAuthStateRepository } from "../src/repositories/oauth";
import { createObjectRepository } from "../src/repositories/objects";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

const username = (id: string) => `u${id.replaceAll("-", "").slice(0, 12)}`;

function tokenJson(access: string) {
  return {
    ok: true,
    json: async () => ({ access_token: access, expires_in: 3600, token_type: "Bearer" })
  } as Response;
}

integration("oauth state and refresh", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await client?.close();
  });

  it("binds single-use states and transparently refreshes expired tokens", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const previousKey = process.env.OAUTH_TOKEN_KEY;
    const previousId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const previousSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.OAUTH_TOKEN_KEY = randomBytes(32).toString("hex");
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    try {
      const states = createOAuthStateRepository(client);
      const connections = createConnectionRepository(client);
      const owner = randomUUID();
      const stranger = randomUUID();
      await createObjectRepository(client).provisionUser({ id: owner, username: username(owner), email: null });
      await createObjectRepository(client).provisionUser({ id: stranger, username: username(stranger), email: null });

      const state = await states.create(owner, "GOOGLE_DRIVE");
      expect(state).toHaveLength(64);
      // Foreign users cannot spend another user's state.
      await expect(states.consume(stranger, state)).rejects.toBeInstanceOf(OAuthStateError);
      expect(await states.consume(owner, state)).toBe("GOOGLE_DRIVE");
      // Single use: replays fail.
      await expect(states.consume(owner, state)).rejects.toBeInstanceOf(OAuthStateError);

      // Expired states fail even for the owner.
      const stale = await states.create(owner, "GOOGLE_CONTACTS");
      if (!client) throw new Error("unreachable");
      await client.sql.begin(async (sql) => {
        await sql`select set_config('app.current_user_id', ${owner}, true)`;
        await sql`update oauth_states set expires_at = now() - interval '1 hour' where state = ${stale}`;
      });
      await expect(states.consume(owner, stale)).rejects.toBeInstanceOf(OAuthStateError);

      // Expired connections with a refresh token rotate on read.
      await connections.connect(owner, {
        provider: "GOOGLE_DRIVE",
        accessToken: "old-access",
        refreshToken: "live-refresh",
        scopes: [],
        expiresInSeconds: 3600
      });
      await client.sql.begin(async (sql) => {
        await sql`select set_config('app.current_user_id', ${owner}, true)`;
        await sql`update provider_connections set expires_at = now() - interval '1 hour' where user_id = ${owner} and provider = 'GOOGLE_DRIVE'`;
      });
      const fetchMock = vi.fn(async () => tokenJson("fresh-access"));
      vi.stubGlobal("fetch", fetchMock);
      expect(await connections.liveToken(owner, "GOOGLE_DRIVE")).toEqual({
        provider: "GOOGLE_DRIVE",
        accessToken: "fresh-access"
      });
      const summaries = await connections.status(owner);
      expect(summaries.find((entry) => entry.provider === "GOOGLE_DRIVE")?.status).toBe("connected");

      // Revoked refresh tokens degrade to absence for operator fallback.
      await client.sql.begin(async (sql) => {
        await sql`select set_config('app.current_user_id', ${owner}, true)`;
        await sql`update provider_connections set expires_at = now() - interval '1 hour' where user_id = ${owner} and provider = 'GOOGLE_DRIVE'`;
      });
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "invalid_grant" }) }) as Response));
      await expect(connections.liveToken(owner, "GOOGLE_DRIVE")).rejects.toBeInstanceOf(ConnectionNotFoundError);
    } finally {
      if (previousKey === undefined) delete process.env.OAUTH_TOKEN_KEY;
      else process.env.OAUTH_TOKEN_KEY = previousKey;
      if (previousId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = previousId;
      if (previousSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = previousSecret;
      vi.unstubAllGlobals();
    }
  }, 60_000);
});
