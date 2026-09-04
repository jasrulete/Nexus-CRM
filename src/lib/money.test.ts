import { describe, expect, it } from "vitest";

import {
  convertAmount,
  formatDealAmount,
  isSupportedCurrency,
  needsConversion,
  SUPPORTED_CURRENCIES,
  WORKSPACE_CURRENCY,
} from "./money";

describe("formatDealAmount", () => {
  it("shows one amount when the deal is already in the workspace currency", () => {
    expect(
      formatDealAmount({ value: 48_000, currency: "USD", baseValue: 48_000 }),
    ).toBe("$48,000");
  });

  it("shows the converted amount with the entered one alongside", () => {
    // The whole point: a reader can see both what was agreed and what it is
    // worth in the currency every total is expressed in.
    expect(
      formatDealAmount({ value: 62_000, currency: "EUR", baseValue: 72_538 }),
    ).toBe("$72,538 (EUR 62,000)");
  });

  it("names the original by code, not symbol", () => {
    // "$72,538 ($62,000)" would be unreadable — CAD, SGD, AUD and USD all use
    // a dollar sign.
    expect(
      formatDealAmount({ value: 62_000, currency: "CAD", baseValue: 45_000 }),
    ).toBe("$45,000 (CAD 62,000)");
  });

  it("does not invent decimals", () => {
    expect(
      formatDealAmount({ value: 1_500_000, currency: "JPY", baseValue: 10_120 }),
    ).toBe("$10,120 (JPY 1,500,000)");
  });
});

describe("convertAmount", () => {
  it("rounds to whole units", () => {
    expect(convertAmount(62_000, 1.1699)).toBe(72_534);
    // Rounds down as well as up: 999 * 1.0005 is 999.4995.
    expect(convertAmount(999, 1.0005)).toBe(999);
    expect(convertAmount(999, 1.001)).toBe(1_000);
  });

  it("is exact at a rate of 1", () => {
    // The single-currency path must not drift by a rounding unit.
    for (const v of [0, 1, 999, 48_000, 1_000_000_000]) {
      expect(convertAmount(v, 1)).toBe(v);
    }
  });
});

describe("workspace currency", () => {
  it("is one of the currencies a deal may be entered in", () => {
    // Otherwise the picker could not express a deal in the workspace's own
    // currency, and every deal would need a rate.
    expect(isSupportedCurrency(WORKSPACE_CURRENCY)).toBe(true);
  });

  it("needs no conversion for itself", () => {
    expect(needsConversion(WORKSPACE_CURRENCY)).toBe(false);
    expect(needsConversion("EUR")).toBe(WORKSPACE_CURRENCY !== "EUR");
  });

  it("rejects a code outside the supported list", () => {
    expect(isSupportedCurrency("XYZ")).toBe(false);
    expect(isSupportedCurrency("usd")).toBe(false);
  });

  it("has no duplicates in the picker list", () => {
    expect(new Set(SUPPORTED_CURRENCIES).size).toBe(SUPPORTED_CURRENCIES.length);
  });
});
