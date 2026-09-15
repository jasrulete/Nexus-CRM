import "server-only";

/**
 * Fixed-window in-memory rate limiter.
 *
 * Suitable for a single-process deployment (this app's free-tier target).
 * For multi-instance production use, back this with Redis or a database.
 */
const buckets = new Map<string, { count: number; resetAt: number; limit: number }>();

/**
 * Keys are chosen by callers, and on the login path by whoever is calling: a
 * fresh email per request used to add entries the periodic sweep would not
 * touch for fifteen minutes. Past this many, expired buckets go first, then
 * the oldest that are not at their limit, then the oldest of all, so a flood
 * of keys cannot grow memory without limit — and cannot flush a lockout: a
 * flood's keys sit at count one, a lockout sits at its limit, so a flood
 * evicts itself before it evicts anyone's block.
 */
export const MAX_BUCKETS = 10_000;

function makeRoom(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  // Insertion order is oldest first.
  for (const [key, bucket] of buckets) {
    if (buckets.size < MAX_BUCKETS) break;
    if (bucket.count < bucket.limit) buckets.delete(key);
  }
  for (const key of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (!bucket) makeRoom(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs, limit });
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

// Opportunistic cleanup so the map doesn't hold expired buckets for long.
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
