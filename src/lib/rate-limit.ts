import "server-only";

/**
 * Fixed-window in-memory rate limiter.
 *
 * Suitable for a single-process deployment (this app's free-tier target).
 * For multi-instance production use, back this with Redis or a database.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Reads a key's current standing without consuming budget, so callers can
 * charge only the outcomes they care about (e.g. failed logins, not successful
 * ones — otherwise a shared demo account throttles its own visitors).
 */
export function peekLimit(
  key: string,
  { limit }: { limit: number },
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) return { ok: true, retryAfterSec: 0 };
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

// Opportunistic cleanup so the map doesn't grow unbounded.
const CLEANUP_EVERY = 5 * 60_000;
let lastCleanup = Date.now();
export function sweepExpiredBuckets() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_EVERY) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
