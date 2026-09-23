import { bucketForPath, createRateLimiter, type RateLimiter } from "@lifegraph/ratelimit";

const globalForRateLimit = globalThis as unknown & { __lifegraphRateLimiter?: RateLimiter };

export function getRateLimiter(): RateLimiter {
  if (!globalForRateLimit.__lifegraphRateLimiter) {
    globalForRateLimit.__lifegraphRateLimiter = createRateLimiter();
  }
  return globalForRateLimit.__lifegraphRateLimiter;
}

/** Test-only reset so one test cannot exhaust another test's budget. */
export function resetRateLimiter() {
  getRateLimiter().reset();
}

export function rateLimitKeyFor(request: Request, actorId?: string) {
  if (actorId) return `user:${actorId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded ?? request.headers.get("x-real-ip") ?? "anonymous";
  return `ip:${ip}`;
}

export function bucketAndKeyFor(request: Request, actorId?: string) {
  const pathname = new URL(request.url).pathname;
  return { bucket: bucketForPath(pathname), key: rateLimitKeyFor(request, actorId) };
}
