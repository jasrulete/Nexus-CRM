/**
 * The rule-based lead scorer, on its own so it can be imported from anywhere.
 *
 * It lived in heuristics.ts, which is marked `server-only` — right for the
 * summary and email fallbacks, but that marker throws under plain `tsx`, and
 * the demo seed (prisma/seed-data.ts) needs this scorer so that a seeded score
 * is exactly what the app would compute offline rather than a hand-typed
 * number. No imports, on purpose: this must load in the seed, the Docker
 * seed bundle, the server action and the test suite alike.
 */

export type ScoringInput = {
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
