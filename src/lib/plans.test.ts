import { describe, expect, it } from "vitest";
import { capMessage, limitsFor, PLAN_LIMITS } from "./plans";

describe("PLAN_LIMITS", () => {
  it("holds the spec §7 numbers", () => {
    expect(PLAN_LIMITS.FREE).toEqual({
      members: 1,
      contacts: 200,
      companies: 100,
      deals: 100,
      aiActionsPerMonth: 30,
    });
    expect(PLAN_LIMITS.PAID).toEqual({
      members: 10,
      contacts: 10_000,
      companies: 5_000,
      deals: 5_000,
      aiActionsPerMonth: 600,
    });
  });
});

describe("limitsFor", () => {
  it("is unlimited in single mode, whatever the plan", () => {
    expect(limitsFor("single", "FREE")).toBeNull();
    expect(limitsFor("single", "PAID")).toBeNull();
  });

  it("returns the plan's limits in multi mode", () => {
    expect(limitsFor("multi", "FREE")).toBe(PLAN_LIMITS.FREE);
    expect(limitsFor("multi", "PAID")).toBe(PLAN_LIMITS.PAID);
  });

  it("treats an unknown plan as FREE", () => {
    expect(limitsFor("multi", "ENTERPRISE")).toBe(PLAN_LIMITS.FREE);
    expect(limitsFor("multi", "")).toBe(PLAN_LIMITS.FREE);
  });
});

describe("capMessage", () => {
  it("names the limit and the way out, plainly", () => {
    expect(capMessage("contacts", 200)).toBe(
      "Your plan allows 200 contacts. Delete some or upgrade to add more.",
    );
    expect(capMessage("deals", 5000)).toBe(
      "Your plan allows 5,000 deals. Delete some or upgrade to add more.",
    );
  });
});
