import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cn,
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatDateOnly,
  fullName,
  initials,
  isOverdueDateOnly,
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

describe("formatCompactCurrency determinism", () => {
  // These exact strings were verified identical in Node's ICU and in Chrome.
  // A mismatch between the two is a hydration error, not a cosmetic one: the
  // kanban headers render on the server, so React rebuilds the entire board on
  // the client when they disagree — which silently breaks keyboard focus.
  it.each([
    [61_000, "$61K"],
    [24_600, "$24.6K"],
    [53_000, "$53K"],
    [62_000, "$62K"],
    [1_000, "$1K"],
    [999, "$999"],
    [1_250_000, "$1.3M"],
    [0, "$0"],
  ])("formats %i as %s with no trailing zero", (value, expected) => {
    expect(formatCompactCurrency(value)).toBe(expected);
  });
});

describe("isOverdueDateOnly", () => {
  // A task due 2026-08-22, stored the way the app stores date-only fields.
  const due = "2026-08-22T00:00:00.000Z";

  it("is not overdue on the evening before, in a negative UTC offset", () => {
    // The regression: 20:01 in New York on the 21st is 00:01 UTC on the 22nd.
    // Comparing raw instants made this overdue while the label still read
    // "Aug 22, 2026" — the row said due-tomorrow and overdue at the same time.
    expect(isOverdueDateOnly(due, new Date("2026-08-22T00:01:00.000Z"))).toBe(false);
  });

  it("is not overdue at any point during its own UTC day", () => {
    expect(isOverdueDateOnly(due, new Date("2026-08-22T00:00:00.000Z"))).toBe(false);
    expect(isOverdueDateOnly(due, new Date("2026-08-22T12:00:00.000Z"))).toBe(false);
    expect(isOverdueDateOnly(due, new Date("2026-08-22T23:59:59.000Z"))).toBe(false);
  });

  it("is overdue once the UTC day has passed", () => {
    expect(isOverdueDateOnly(due, new Date("2026-08-23T00:00:00.000Z"))).toBe(true);
    expect(isOverdueDateOnly(due, new Date("2026-09-01T00:00:00.000Z"))).toBe(true);
  });

  it("is not overdue for a future date", () => {
    expect(isOverdueDateOnly(due, new Date("2026-08-01T00:00:00.000Z"))).toBe(false);
  });

  it("agrees with the label it sits next to, across a whole day", () => {
    // The property that actually matters: the styling and formatDateOnly must
    // never disagree about which day it is.
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(`2026-08-22T${String(hour).padStart(2, "0")}:30:00.000Z`);
      expect(formatDateOnly(due)).toBe("Aug 22, 2026");
      expect(isOverdueDateOnly(due, now)).toBe(false);
    }
  });

  it("treats absent and unparseable values as not overdue", () => {
    expect(isOverdueDateOnly(null)).toBe(false);
    expect(isOverdueDateOnly(undefined)).toBe(false);
    expect(isOverdueDateOnly("not a date")).toBe(false);
  });
});
