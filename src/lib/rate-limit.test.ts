import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The limiter keeps module-level state (buckets map, cleanup timestamp),
 * so each test imports a fresh copy of the module under fake timers.
 */
async function freshLimiter() {
  vi.resetModules();
  return import("./rate-limit");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows requests under the limit", async () => {
    const { rateLimit } = await freshLimiter();
    const opts = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("login:1.2.3.4", opts)).toEqual({
        ok: true,
        retryAfterSec: 0,
      });
    }
  });

  it("blocks the request that exceeds the limit and reports retry-after", async () => {
    const { rateLimit } = await freshLimiter();
    const opts = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) rateLimit("login:1.2.3.4", opts);

    const blocked = rateLimit("login:1.2.3.4", opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
  });

  it("tracks keys independently", async () => {
    const { rateLimit } = await freshLimiter();
    const opts = { limit: 1, windowMs: 60_000 };
    rateLimit("login:1.2.3.4", opts);
    expect(rateLimit("login:1.2.3.4", opts).ok).toBe(false);
    expect(rateLimit("login:5.6.7.8", opts).ok).toBe(true);
  });

  it("allows again once the window expires", async () => {
    const { rateLimit } = await freshLimiter();
    const opts = { limit: 1, windowMs: 1_000 };
    expect(rateLimit("ai:user1", opts).ok).toBe(true);
    expect(rateLimit("ai:user1", opts).ok).toBe(false);

    vi.advanceTimersByTime(1_001);
    expect(rateLimit("ai:user1", opts).ok).toBe(true);
  });
});

describe("sweepExpiredBuckets", () => {
  it("keeps live buckets intact when the periodic sweep runs", async () => {
    const { rateLimit, sweepExpiredBuckets } = await freshLimiter();
    // A long-window bucket that is already exhausted…
    const longOpts = { limit: 1, windowMs: 10 * 60_000 };
    rateLimit("busy", longOpts);
    expect(rateLimit("busy", longOpts).ok).toBe(false);

    // …survives a sweep 5+ minutes later and stays blocked.
    vi.advanceTimersByTime(5 * 60_000 + 1);
    sweepExpiredBuckets();
    expect(rateLimit("busy", longOpts).ok).toBe(false);
  });

  it("lets swept (expired) keys start a fresh window", async () => {
    const { rateLimit, sweepExpiredBuckets } = await freshLimiter();
    const opts = { limit: 1, windowMs: 1_000 };
    rateLimit("stale", opts);

    vi.advanceTimersByTime(5 * 60_000 + 1);
    sweepExpiredBuckets();
    expect(rateLimit("stale", opts)).toEqual({ ok: true, retryAfterSec: 0 });
  });
});
