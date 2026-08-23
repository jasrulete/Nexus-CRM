import { afterEach, describe, expect, it, vi } from "vitest";

import { __clearRateCache, getRateToWorkspaceCurrency } from "./fx";
import { WORKSPACE_CURRENCY } from "./money";

afterEach(() => {
  __clearRateCache();
  vi.restoreAllMocks();
});

function rateResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("getRateToWorkspaceCurrency", () => {
  it("returns 1 without a network call for the workspace currency itself", async () => {
    // This is the common case, and it means a single-currency workspace never
    // depends on a third party being reachable.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(getRateToWorkspaceCurrency(WORKSPACE_CURRENCY)).resolves.toEqual({
      ok: true,
      rate: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the rate for the workspace currency out of the response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      rateResponse({ base: "EUR", rates: { [WORKSPACE_CURRENCY]: 1.1699 } }),
    );

    await expect(getRateToWorkspaceCurrency("EUR")).resolves.toEqual({
      ok: true,
      rate: 1.1699,
    });
  });

  it("caches within the day so one page of deals is one request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      rateResponse({ rates: { [WORKSPACE_CURRENCY]: 1.1699 } }),
    );

    await getRateToWorkspaceCurrency("EUR");
    await getRateToWorkspaceCurrency("EUR");
    await getRateToWorkspaceCurrency("EUR");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Every one of these must report failure rather than fall back to 1. A rate
  // of 1 would store a EUR amount as if it were dollars and corrupt every total
  // the deal appears in — silently, and permanently, because the rate is frozen.
  it.each([
    ["a non-2xx response", () => rateResponse({}, 503)],
    ["a response with no rates object", () => rateResponse({ base: "EUR" })],
    ["a response missing the target currency", () => rateResponse({ rates: { CHF: 0.9 } })],
    ["a non-numeric rate", () => rateResponse({ rates: { [WORKSPACE_CURRENCY]: "1.17" } })],
    ["a zero rate", () => rateResponse({ rates: { [WORKSPACE_CURRENCY]: 0 } })],
    ["a negative rate", () => rateResponse({ rates: { [WORKSPACE_CURRENCY]: -1.17 } })],
    ["a NaN rate", () => rateResponse({ rates: { [WORKSPACE_CURRENCY]: null } })],
  ])("reports unavailable for %s", async (_label, make) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(make());

    await expect(getRateToWorkspaceCurrency("EUR")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("reports unavailable when the provider cannot be reached at all", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    );

    await expect(getRateToWorkspaceCurrency("EUR")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("does not cache a failure, so the next save can succeed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(rateResponse({}, 503))
      .mockResolvedValueOnce(rateResponse({ rates: { [WORKSPACE_CURRENCY]: 1.17 } }));

    await expect(getRateToWorkspaceCurrency("EUR")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(getRateToWorkspaceCurrency("EUR")).resolves.toEqual({
      ok: true,
      rate: 1.17,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
