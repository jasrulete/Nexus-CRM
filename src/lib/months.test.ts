import { describe, expect, it } from "vitest";
import { lastSixMonths, monthKey } from "./months";

describe("lastSixMonths", () => {
  it("returns the current month and the five before it, oldest first", () => {
    const keys = lastSixMonths(new Date(2026, 8, 3)).map(monthKey);
    expect(keys).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  });

  it("crosses a year boundary", () => {
    const keys = lastSixMonths(new Date(2026, 0, 15)).map(monthKey);
    expect(keys).toEqual(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
  });

  // The dashboard used to do `setMonth(getMonth() - 5)` and only then
  // `setDate(1)`. On July 29–31 that lands on "February 29–31", which JS
  // normalises into early March, so the window became March–August: February's
  // revenue vanished and the chart showed an empty month that had not started.
  // Three days a year, silently. Constructing the date with day 1 cannot overflow.
  it("does not skip February when today is July 31", () => {
    const keys = lastSixMonths(new Date(2026, 6, 31)).map(monthKey);
    expect(keys).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
  });

  it("starts each month at local midnight on the 1st", () => {
    for (const d of lastSixMonths(new Date(2026, 6, 31, 17, 45))) {
      expect(d.getDate()).toBe(1);
      expect(d.getHours()).toBe(0);
    }
  });
});
