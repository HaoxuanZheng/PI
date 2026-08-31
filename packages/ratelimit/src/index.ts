export type RateLimitRule = { limit: number; windowSeconds: number };

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Seconds until the window resets. Suitable for a Retry-After header. */
  retryAfterSeconds: number;
};

/**
 * Per-route budgets. Expensive or abusable operations are tighter than ordinary reads.
 *
 * These are deliberately conservative: an alpha exists to find the right numbers, and a limit that
 * is too generous provides no protection at all.
 */
export const rateLimitRules = {
  DEFAULT: { limit: 240, windowSeconds: 60 },
  AI: { limit: 20, windowSeconds: 60 },
  RETRIEVAL: { limit: 60, windowSeconds: 60 },
  IMPORT: { limit: 30, windowSeconds: 60 },
  PUBLISH: { limit: 20, windowSeconds: 60 },
  UPLOAD: { limit: 60, windowSeconds: 60 },
  // Account export assembles a large slice of the database, so it is strictly bounded.
  EXPORT: { limit: 3, windowSeconds: 3_600 },
  ACCOUNT: { limit: 10, windowSeconds: 3_600 }
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof rateLimitRules;

type Window = { count: number; resetAt: number };

export type RateLimiter = {
  check(key: string, bucket: RateLimitBucket): RateLimitDecision;
  reset(): void;
  size(): number;
};

/**
 * Fixed-window counter held in process memory.
 *
 * This protects a single instance only: it is not shared across processes, so a horizontally scaled
 * deployment needs a shared store before these numbers mean anything globally. It is still worth
 * having, because it bounds accidental loops and single-client abuse.
 */
export function createRateLimiter(options: { now?: () => number; maxKeys?: number } = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, Window>();

  /** Drops expired windows so the map cannot grow without bound. */
  function evict(currentTime: number) {
    for (const [key, window] of windows) {
      if (window.resetAt <= currentTime) windows.delete(key);
    }
  }

  return {
    check(key, bucket) {
      const rule = rateLimitRules[bucket];
      const currentTime = now();
      const windowKey = `${bucket}:${key}`;
      const existing = windows.get(windowKey);

      if (!existing || existing.resetAt <= currentTime) {
        if (windows.size >= maxKeys) evict(currentTime);
        // Under sustained pressure from many distinct keys, fail closed rather than grow unbounded.
        if (windows.size >= maxKeys) {
          return { allowed: false, remaining: 0, limit: rule.limit, retryAfterSeconds: rule.windowSeconds };
        }
        windows.set(windowKey, { count: 1, resetAt: currentTime + rule.windowSeconds * 1_000 });
        return { allowed: true, remaining: rule.limit - 1, limit: rule.limit, retryAfterSeconds: rule.windowSeconds };
      }

      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - currentTime) / 1_000));
      if (existing.count >= rule.limit) {
        return { allowed: false, remaining: 0, limit: rule.limit, retryAfterSeconds };
      }
      existing.count += 1;
      return { allowed: true, remaining: rule.limit - existing.count, limit: rule.limit, retryAfterSeconds };
    },

    reset() {
      windows.clear();
    },

    size() {
      return windows.size;
    }
  };
}

/** Chooses a budget from a request path, so wiring cannot drift from the rule table. */
export function bucketForPath(pathname: string): RateLimitBucket {
  if (pathname.includes("/account/export")) return "EXPORT";
  if (pathname.includes("/account")) return "ACCOUNT";
  if (pathname.includes("/ai/") || pathname.includes("/ask")) return "AI";
  if (pathname.includes("/retrieval")) return "RETRIEVAL";
  if (pathname.includes("/imports") || pathname.includes("/entities")) return "IMPORT";
  if (pathname.includes("/publications")) return "PUBLISH";
  if (pathname.includes("/files")) return "UPLOAD";
  return "DEFAULT";
}
