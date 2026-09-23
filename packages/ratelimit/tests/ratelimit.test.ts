import { describe, expect, it } from "vitest";
import { bucketForPath, createRateLimiter, rateLimitRules } from "../src/index.js";

describe("rate limiter", () => {
  it("allows up to the limit then rejects with retryAfter", () => {
    const now = 0;
    const limiter = createRateLimiter({ now: () => now });
    for (let i = 0; i < rateLimitRules.DEFAULT.limit; i++) {
      const decision = limiter.check("user-1", "DEFAULT");
      expect(decision.allowed).toBe(true);
    }
    const blocked = limiter.check("user-1", "DEFAULT");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("isolates buckets and keys", () => {
    const now = 0;
    const limiter = createRateLimiter({ now: () => now });
    expect(limiter.check("user-1", "AI").allowed).toBe(true);
    expect(limiter.check("user-2", "AI").allowed).toBe(true);
    expect(limiter.check("user-1", "DEFAULT").allowed).toBe(true);
  });

  it("resets after the window", () => {
    let now = 0;
    const limiter = createRateLimiter({ now: () => now });
    for (let i = 0; i < rateLimitRules.AI.limit; i++) limiter.check("user-1", "AI");
    expect(limiter.check("user-1", "AI").allowed).toBe(false);
    now += 61_000;
    expect(limiter.check("user-1", "AI").allowed).toBe(true);
  });

  it("fails closed when key space is exhausted", () => {
    const limiter = createRateLimiter({ now: () => 0, maxKeys: 1 });
    expect(limiter.check("a", "DEFAULT").allowed).toBe(true);
    expect(limiter.check("b", "DEFAULT").allowed).toBe(false);
  });
});

describe("bucketForPath", () => {
  it("maps expensive routes to tight budgets", () => {
    expect(bucketForPath("/api/v1/account/export")).toBe("EXPORT");
    expect(bucketForPath("/api/v1/account/delete")).toBe("ACCOUNT");
    expect(bucketForPath("/api/v1/ai/operations/generate")).toBe("AI");
    expect(bucketForPath("/api/v1/ask")).toBe("AI");
    expect(bucketForPath("/api/v1/retrieval/search")).toBe("RETRIEVAL");
    expect(bucketForPath("/api/v1/imports/start")).toBe("IMPORT");
    expect(bucketForPath("/api/v1/publications")).toBe("PUBLISH");
    expect(bucketForPath("/api/v1/files/upload-intent")).toBe("UPLOAD");
    expect(bucketForPath("/api/v1/objects")).toBe("DEFAULT");
  });
});
