import { describe, expect, it } from "vitest";
import { activityHref, nameTerms, snippet } from "./search";

describe("snippet", () => {
  const body =
    "Kickoff-style call with Tomas and Luna. " +
    "They want onboarding help for 12 seats and asked about SSO. ".repeat(3) +
    "Procurement window opens next quarter, so re-engage mid-August with the case study. " +
    "Follow up on pricing.";

  it("windows the first case-insensitive match with ellipses on cut edges", () => {
    const out = snippet(body, "PROCUREMENT WINDOW");
    expect(out.startsWith("…")).toBe(true);
    expect(out).toContain("Procurement window");
    expect(out.length).toBeLessThanOrEqual(90 + 2);
  });

  it("has no leading ellipsis when the match starts the text", () => {
    expect(snippet("Kickoff call with Maya about pricing.", "kickoff")).toBe(
      "Kickoff call with Maya about pricing.",
    );
  });

  it("falls back to the head of the content when the phrase does not occur", () => {
    // Prisma's LIKE and JS toLowerCase disagree on some non-ASCII input, so a
    // row can match on the server and not in here; show something useful.
    const out = snippet(body, "no such phrase");
    expect(out.startsWith("Kickoff-style call")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("collapses newlines and runs of whitespace", () => {
    expect(snippet("line one\n\n   line   two", "two")).toBe("line one line two");
  });
});

describe("nameTerms", () => {
  it("splits at the first space and keeps the remainder together", () => {
    expect(nameTerms("Maya Okafor")).toEqual(["Maya", "Okafor"]);
    expect(nameTerms("Ana de la Cruz")).toEqual(["Ana", "de la Cruz"]);
  });

  it("returns null for a single term", () => {
    expect(nameTerms("Maya")).toBeNull();
    expect(nameTerms("  Maya  ")).toBeNull();
  });
});

describe("activityHref", () => {
  it("prefers the deal, then the contact, then the company", () => {
    expect(activityHref({ dealId: "d1", contactId: "c1", companyId: "co1" })).toBe("/deals/d1");
    expect(activityHref({ dealId: null, contactId: "c1", companyId: "co1" })).toBe("/contacts/c1");
    expect(activityHref({ dealId: null, contactId: null, companyId: "co1" })).toBe("/companies/co1");
  });
});
