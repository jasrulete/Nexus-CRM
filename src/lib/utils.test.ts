import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cn,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatDateOnly,
  fullName,
  initials,
  timeAgo,
} from "./utils";

describe("formatCurrency", () => {
  it("formats whole-dollar amounts with grouping and no cents", () => {
    expect(formatCurrency(50_000)).toBe("$50,000");
    expect(formatCurrency(0)).toBe("$0");
  });

  it("rounds fractional amounts to whole dollars", () => {
    expect(formatCurrency(1234.56)).toBe("$1,235");
  });

  it("respects the currency argument", () => {
    expect(formatCurrency(50_000, "EUR")).toBe("€50,000");
  });
});

describe("formatCompactCurrency", () => {
  it("compacts large values with one decimal", () => {
    expect(formatCompactCurrency(1_500_000)).toBe("$1.5M");
    expect(formatCompactCurrency(2_500)).toBe("$2.5K");
  });
});

describe("formatDate / formatDateOnly", () => {
  it("renders an em dash for missing dates", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateOnly(undefined)).toBe("—");
  });

  it("renders date-only fields in UTC so the day never shifts", () => {
    // Stored at UTC midnight — local-time rendering could show Jul 18.
    expect(formatDateOnly("2026-07-19T00:00:00.000Z")).toBe("Jul 19, 2026");
  });
});

describe("timeAgo", () => {
  afterEach(() => vi.useRealTimers());

  it("describes past and future moments relative to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));

    expect(timeAgo(new Date("2026-07-19T10:00:00Z"))).toBe("2 hours ago");
    expect(timeAgo(new Date("2026-07-18T11:00:00Z"))).toBe("yesterday");
    expect(timeAgo(new Date("2026-07-19T14:00:00Z"))).toBe("in 2 hours");
  });

  it("calls anything under a minute 'just now'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));

    expect(timeAgo(new Date("2026-07-19T11:59:30Z"))).toBe("just now");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words, uppercased", () => {
    expect(initials("Maya Okafor")).toBe("MO");
    expect(initials("  maya   jane   okafor ")).toBe("MJ");
    expect(initials("plato")).toBe("P");
  });
});

describe("fullName", () => {
  it("joins first and last name", () => {
    expect(fullName({ firstName: "Maya", lastName: "Okafor" })).toBe(
      "Maya Okafor",
    );
  });
});

describe("cn", () => {
  it("merges conflicting tailwind classes, last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy conditional classes", () => {
    expect(cn("btn", false, undefined, "active")).toBe("btn active");
  });
});
