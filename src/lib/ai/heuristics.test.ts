import { describe, expect, it } from "vitest";
import {
  heuristicEmailDraft,
  heuristicLeadScore,
  heuristicSummary,
} from "./heuristics";

/** A contact with nothing going for it — the scoring baseline. */
const bare = {
  status: "LEAD",
  hasEmail: false,
  hasPhone: false,
  hasCompany: false,
  title: null,
  source: null,
  openDealCount: 0,
  openDealValue: 0,
  wonDealCount: 0,
  activityCount: 0,
  daysSinceLastActivity: null,
};

describe("heuristicLeadScore", () => {
  it("scores an empty profile at the 20-point baseline", () => {
    const { score, reason } = heuristicLeadScore(bare);
    expect(score).toBe(20);
    expect(reason).toBe("Rule-based score from profile completeness.");
  });

  it("adds completeness points for email and phone", () => {
    expect(heuristicLeadScore({ ...bare, hasEmail: true }).score).toBe(28);
    expect(
      heuristicLeadScore({ ...bare, hasEmail: true, hasPhone: true }).score,
    ).toBe(34);
  });

  it("rewards senior decision-maker titles but not other titles", () => {
    const vp = heuristicLeadScore({ ...bare, title: "VP of Data" });
    expect(vp.score).toBe(32); // 20 + 12
    expect(vp.reason).toContain("senior decision-maker title");

    const ic = heuristicLeadScore({ ...bare, title: "Software Engineer" });
    expect(ic.score).toBe(20);
  });

  it("rewards referrals and explains why", () => {
    const { score, reason } = heuristicLeadScore({ ...bare, source: "referral" });
    expect(score).toBe(28);
    expect(reason).toContain("came via referral");
  });

  it("caps the open-deal bonus at 20 points", () => {
    const one = heuristicLeadScore({ ...bare, openDealCount: 1 });
    const five = heuristicLeadScore({ ...bare, openDealCount: 5 });
    expect(one.score).toBe(30); // 20 + 10
    expect(five.score).toBe(40); // 20 + capped 20, not 20 + 50
    expect(five.reason).toContain("5 open deal(s)");
  });

  it("adds the pipeline-value bonus only at $25k and above", () => {
    expect(heuristicLeadScore({ ...bare, openDealValue: 25_000 }).score).toBe(30);
    expect(heuristicLeadScore({ ...bare, openDealValue: 24_999 }).score).toBe(20);
  });

  it("penalizes contacts quiet for more than 30 days", () => {
    expect(
      heuristicLeadScore({ ...bare, daysSinceLastActivity: 31 }).score,
    ).toBe(8);
    // exactly 30 days is not yet "gone quiet"
    expect(
      heuristicLeadScore({ ...bare, daysSinceLastActivity: 30 }).score,
    ).toBe(20);
  });

  it("caps churned contacts at 25 no matter how strong the profile", () => {
    const { score, reason } = heuristicLeadScore({
      ...bare,
      status: "CHURNED",
      hasEmail: true,
      hasPhone: true,
      hasCompany: true,
      title: "Founder",
      openDealCount: 2,
    });
    expect(score).toBe(25);
    expect(reason).toContain("previously churned");
  });

  it("never exceeds 100 even with every bonus stacked", () => {
    const { score } = heuristicLeadScore({
      status: "QUALIFIED",
      hasEmail: true,
      hasPhone: true,
      hasCompany: true,
      title: "Chief Revenue Officer",
      source: "referral",
      openDealCount: 5,
      openDealValue: 100_000,
      wonDealCount: 2,
      activityCount: 10,
      daysSinceLastActivity: 1,
    });
    expect(score).toBe(100);
  });

  it("joins multiple reasons into one sentence", () => {
    const { reason } = heuristicLeadScore({
      ...bare,
      hasCompany: true,
      source: "referral",
    });
    expect(reason).toBe(
      "Rule-based score: linked to a company, came via referral.",
    );
  });
});

describe("heuristicEmailDraft", () => {
  it("re-engages when the contact has gone quiet for 15+ days", () => {
    const draft = heuristicEmailDraft({
      contactFirstName: "Maya",
      senderName: "Demo User",
      dealTitle: null,
      daysSinceLastActivity: 20,
    });
    expect(draft).toContain("It's been a little while");
    expect(draft).toContain("Hi Maya,");
    expect(draft).toContain("Demo User");
  });

  it("references the open deal by title when there is one", () => {
    const draft = heuristicEmailDraft({
      contactFirstName: "Daniel",
      senderName: "Demo User",
      dealTitle: "Claims Team Expansion",
      daysSinceLastActivity: 2,
    });
    expect(draft).toContain('"Claims Team Expansion"');
    expect(draft).toContain("Thanks again for the recent conversation.");
    expect(draft.startsWith("Subject: Quick follow-up")).toBe(true);
  });
});

describe("heuristicSummary", () => {
  it("totals the open pipeline and lists each deal", () => {
    const summary = heuristicSummary({
      name: "Maya Okafor",
      status: "QUALIFIED",
      companyName: "Northwind Analytics",
      openDeals: [
        { title: "Dashboard Replacement", value: 10_000, stage: "PROPOSAL" },
        { title: "Support Add-on", value: 2_500, stage: "LEAD" },
      ],
      recentActivities: [],
    });
    expect(summary).toContain("Maya Okafor is a qualified at Northwind Analytics.");
    expect(summary).toContain("2 deal(s) worth $12,500");
    expect(summary).toContain('"Dashboard Replacement" (proposal)');
    expect(summary).toContain("No activity logged yet");
  });

  it("handles a contact with no deals and truncates long activity notes", () => {
    const summary = heuristicSummary({
      name: "Ari Chen",
      status: "LEAD",
      companyName: null,
      openDeals: [],
      recentActivities: [
        {
          type: "CALL",
          content: "x".repeat(150),
          createdAt: new Date("2026-07-01T12:00:00Z"),
        },
      ],
    });
    expect(summary).toContain("No open deals at the moment.");
    expect(summary).toContain(`"${"x".repeat(120)}…"`);
    expect(summary).toContain("Latest touchpoint: call");
  });
});
