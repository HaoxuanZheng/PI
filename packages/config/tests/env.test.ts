import { describe, expect, it } from "vitest";
import { parsePublicEnv, parseServerEnv } from "../src/index";

const publicEnv = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key"
};

describe("environment validation", () => {
  it("accepts a complete server environment", () => {
    expect(parseServerEnv({ ...publicEnv, DATABASE_URL: "postgresql://localhost/lifegraph" })).toMatchObject({
      NODE_ENV: "development"
    });
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() => parseServerEnv({ ...publicEnv, DATABASE_URL: "mysql://localhost/lifegraph" })).toThrow();
  });

  it("keeps server secrets out of the public contract", () => {
    const result = parsePublicEnv({ ...publicEnv, DATABASE_URL: "postgresql://secret" });
    expect("DATABASE_URL" in result).toBe(false);
  });

  it("requires error tracking in production", () => {
    expect(() => parseServerEnv({
      ...publicEnv,
      DATABASE_URL: "postgresql://localhost/lifegraph",
      NODE_ENV: "production"
    })).toThrow();
  });

  it("defaults file storage to a private bucket with scanning enforced", () => {
    expect(parseServerEnv({ ...publicEnv, DATABASE_URL: "postgresql://localhost/lifegraph" })).toMatchObject({
      STORAGE_BUCKET: "lifegraph-private",
      STORAGE_REQUIRE_SCAN: true
    });
  });

  it("allows disabling the scan gate outside production only", () => {
    expect(parseServerEnv({
      ...publicEnv,
      DATABASE_URL: "postgresql://localhost/lifegraph",
      STORAGE_REQUIRE_SCAN: "false"
    })).toMatchObject({ STORAGE_REQUIRE_SCAN: false });

    expect(() => parseServerEnv({
      ...publicEnv,
      DATABASE_URL: "postgresql://localhost/lifegraph",
      NODE_ENV: "production",
      SENTRY_DSN: "https://sentry.example.com/1",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      STORAGE_REQUIRE_SCAN: "false"
    })).toThrow();
  });

  it("requires a storage service role key in production", () => {
    expect(() => parseServerEnv({
      ...publicEnv,
      DATABASE_URL: "postgresql://localhost/lifegraph",
      NODE_ENV: "production",
      SENTRY_DSN: "https://sentry.example.com/1"
    })).toThrow();
  });
});
