type RateLimitResult =
  | { ok: true; remaining: number; resetAt: number; limit: number }
  | { ok: false; remaining: 0; resetAt: number; limit: number; retryAfterSec: number };

const buckets = new Map<string, { count: number; resetAt: number }>();

function nowMs() {
  return Date.now();
}

function getBucket(key: string, windowMs: number) {
  const now = nowMs();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return fresh;
  }
  return current;
}

export function rateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const bucket = getBucket(params.key, params.windowMs);
  bucket.count += 1;

  const remaining = Math.max(0, params.limit - bucket.count);
  if (bucket.count > params.limit) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - nowMs()) / 1000));
    return {
      ok: false,
      remaining: 0,
      resetAt: bucket.resetAt,
      limit: params.limit,
      retryAfterSec,
    };
  }

  return { ok: true, remaining, resetAt: bucket.resetAt, limit: params.limit };
}

export function rateLimitHeaders(result: RateLimitResult) {
  const resetSec = Math.ceil(result.resetAt / 1000);
  const headers = new Headers();
  headers.set("x-ratelimit-limit", String(result.limit));
  headers.set("x-ratelimit-remaining", String(result.remaining));
  headers.set("x-ratelimit-reset", String(resetSec));
  if (!result.ok) {
    headers.set("retry-after", String(result.retryAfterSec));
  }
  return headers;
}

export function getClientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export const __testing = {
  reset() {
    buckets.clear();
  },
};

