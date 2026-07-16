import "server-only";

/**
 * Deterministic fallbacks used when no AI provider key is configured.
 * Clearly labeled in the UI as "rule-based" so demos stay honest.
 */

type ScoringInput = {
  status: string;
  hasEmail: boolean;
  hasPhone: boolean;
  hasCompany: boolean;
  title: string | null;
  source: string | null;
  openDealCount: number;
  openDealValue: number;
  wonDealCount: number;
  activityCount: number;
  daysSinceLastActivity: number | null;
};

export function heuristicLeadScore(input: ScoringInput): {
  score: number;
  reason: string;
} {
  let score = 20;
  const reasons: string[] = [];

  if (input.hasEmail) score += 8;
  if (input.hasPhone) score += 6;
  if (input.hasCompany) {
    score += 10;
    reasons.push("linked to a company");
  }
  if (input.title && /chief|vp|head|director|founder|owner|president/i.test(input.title)) {
    score += 12;
    reasons.push("senior decision-maker title");
  }
  if (input.source === "referral") {
    score += 8;
    reasons.push("came via referral");
  }
  if (input.openDealCount > 0) {
    score += Math.min(20, input.openDealCount * 10);
    reasons.push(`${input.openDealCount} open deal(s)`);
  }
  if (input.openDealValue >= 25_000) {
    score += 10;
    reasons.push("high open pipeline value");
  }
  if (input.wonDealCount > 0) {
    score += 8;
    reasons.push("existing customer relationship");
  }
  if (input.activityCount >= 3) {
    score += 8;
    reasons.push("actively engaged");
  }
  if (input.daysSinceLastActivity !== null && input.daysSinceLastActivity > 30) {
    score -= 12;
    reasons.push("gone quiet for 30+ days");
  }
  if (input.status === "CHURNED") {
    score = Math.min(score, 25);
    reasons.push("previously churned");
  }

  score = Math.max(0, Math.min(100, score));
  const reason =
    reasons.length > 0
      ? `Rule-based score: ${reasons.join(", ")}.`
      : "Rule-based score from profile completeness.";
  return { score, reason };
}

export function heuristicEmailDraft(input: {
  contactFirstName: string;
  senderName: string;
  dealTitle: string | null;
  daysSinceLastActivity: number | null;
}): string {
  const opener =
    input.daysSinceLastActivity !== null && input.daysSinceLastActivity > 14
      ? `It's been a little while since we last spoke, and I wanted to check back in.`
      : `Thanks again for the recent conversation.`;
  const dealLine = input.dealTitle
    ? `I'd love to keep the momentum going on "${input.dealTitle}" — is there anything you need from my side to move forward?`
    : `I'd love to hear how things are progressing on your side and whether there's anything I can help with.`;

  return `Subject: Quick follow-up

Hi ${input.contactFirstName},

${opener}

${dealLine}

Would a short call this week work for you? Happy to work around your schedule.

Best regards,
${input.senderName}`;
}

export function heuristicSummary(input: {
  name: string;
  status: string;
  companyName: string | null;
  openDeals: { title: string; value: number; stage: string }[];
  recentActivities: { type: string; content: string; createdAt: Date }[];
}): string {
  const lines: string[] = [];
  lines.push(
    `${input.name} is a ${input.status.toLowerCase()}${input.companyName ? ` at ${input.companyName}` : ""}.`,
  );
  if (input.openDeals.length > 0) {
    const total = input.openDeals.reduce((s, d) => s + d.value, 0);
    lines.push(
      `Open pipeline: ${input.openDeals.length} deal(s) worth $${total.toLocaleString()} — ${input.openDeals
        .map((d) => `"${d.title}" (${d.stage.toLowerCase()})`)
        .join(", ")}.`,
    );
  } else {
    lines.push("No open deals at the moment.");
  }
  if (input.recentActivities.length > 0) {
    const last = input.recentActivities[0]!;
    lines.push(
      `Latest touchpoint: ${last.type.toLowerCase()} on ${last.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — "${last.content.slice(0, 120)}${last.content.length > 120 ? "…" : ""}"`,
    );
  } else {
    lines.push("No activity logged yet — worth an initial outreach.");
  }
  return lines.join("\n");
}
