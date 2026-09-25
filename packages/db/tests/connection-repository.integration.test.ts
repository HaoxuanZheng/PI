import { randomBytes, randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/index";
import {
  ConnectionNotFoundError,
  createConnectionRepository
} from "../src/repositories/connections";
import { createObjectRepository } from "../src/repositories/objects";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

const username = (id: string) => `u${id.replaceAll("-", "").slice(0, 12)}`;

integration("connection repository", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
    process.env.OAUTH_TOKEN_KEY = randomBytes(32).toString("hex");
  }, 30_000);

  afterEach(() => {
    process.env.OAUTH_TOKEN_KEY = randomBytes(32).toString("hex");
  });

  afterAll(async () => {
    delete process.env.OAUTH_TOKEN_KEY;
    await client?.close();
  });

  it("stores sealed tokens, serves status without material, and disconnects", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const connections = createConnectionRepository(client);
    const owner = randomUUID();
    await createObjectRepository(client).provisionUser({ id: owner, username: username(owner), email: null });

    await expect(connections.liveToken(owner, "NOTION")).rejects.toBeInstanceOf(ConnectionNotFoundError);
    expect(await connections.status(owner)).toHaveLength(0);

    const connected = await connections.connect(owner, {
      provider: "NOTION",
      accessToken: "ntn_live_token",
      refreshToken: null,
      scopes: ["read"],
      expiresInSeconds: 3600
    });
    expect(connected.provider).toBe("NOTION");
    expect(connected.status).toBe("connected");
    expect(connected.scopes).toEqual(["read"]);
    expect(JSON.stringify(connected)).not.toContain("ntn_live_token");

    expect(await connections.liveToken(owner, "NOTION")).toEqual({
      provider: "NOTION",
      accessToken: "ntn_live_token"
    });

    // Reconnecting replaces the token; status still hides material.
    await connections.connect(owner, {
      provider: "NOTION",
      accessToken: "ntn_rotated_token",
      refreshToken: "ntn_refresh",
      scopes: [],
      expiresInSeconds: null
    });
    expect(await connections.status(owner)).toHaveLength(1);
    expect(await connections.liveToken(owner, "NOTION")).toEqual({
      provider: "NOTION",
      accessToken: "ntn_rotated_token"
    });

    // A rotated encryption key cannot open old rows: explicit failure, never garbage.
    process.env.OAUTH_TOKEN_KEY = randomBytes(32).toString("hex");
    await expect(connections.liveToken(owner, "NOTION")).rejects.toThrowError(/decrypt|configured/);

    await connections.disconnect(owner, "NOTION");
    expect(await connections.status(owner)).toHaveLength(0);
    await expect(connections.liveToken(owner, "NOTION")).rejects.toBeInstanceOf(ConnectionNotFoundError);
    await expect(connections.disconnect(owner, "NOTION")).rejects.toBeInstanceOf(ConnectionNotFoundError);
  }, 60_000);
});
