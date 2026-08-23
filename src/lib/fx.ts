import "server-only";
import { WORKSPACE_CURRENCY } from "./money";

/**
 * Exchange rates, from Frankfurter (https://frankfurter.dev).
 *
 * Chosen because it is free with no API key and no account — this project runs
 * on nothing but free tiers — and because it serves European Central Bank
 * reference rates rather than a scraped feed. Called with `fetch` rather than an
 * SDK, matching how `ai/provider.ts` and `email.ts` already talk to their
 * providers.
 *
 * The result type is deliberately a discriminated union. A rate that could not
 * be fetched must not silently become 1: that would store a EUR amount as if it
 * were dollars and quietly corrupt every total the deal appears in. Callers are
 * expected to refuse the write and say so.
 */

export type RateResult =
  | { ok: true; rate: number }
  | { ok: false; reason: "unavailable" };

/** ECB publishes once per working day, so a day is the natural cache key. */
type CacheEntry = { rate: number; day: string };
const cache = new Map<string, CacheEntry>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Rate to multiply an amount in `from` by to get the workspace currency.
 *
 * Returns 1 without a network call when no conversion is needed, which is the
 * common case — it means a single-currency workspace never depends on a third
 * party being up.
 */
export async function getRateToWorkspaceCurrency(
  from: string,
): Promise<RateResult> {
  const to = WORKSPACE_CURRENCY;
  if (from === to) return { ok: true, rate: 1 };

  const key = `${from}:${to}`;
  const cached = cache.get(key);
  if (cached && cached.day === today()) return { ok: true, rate: cached.rate };

  try {
    const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      console.error("fx: provider returned", res.status);
      return { ok: false, reason: "unavailable" };
    }

    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = json.rates?.[to];
    // A non-finite or non-positive rate would poison every amount derived from
    // it, so it is treated as no rate at all rather than trusted.
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      console.error("fx: provider returned no usable rate for", key);
      return { ok: false, reason: "unavailable" };
    }

    cache.set(key, { rate, day: today() });
    return { ok: true, rate };
  } catch (error) {
    // Timeout, DNS, TLS, connection reset — the provider is simply not there.
    console.error("fx: request failed", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** Test seam: the cache is process-local and must not leak between tests. */
export function __clearRateCache() {
  cache.clear();
}
