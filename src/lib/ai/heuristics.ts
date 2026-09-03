import "server-only";
import { formatCurrency } from "@/lib/utils";

/**
 * Deterministic fallbacks used when no AI provider key is configured.
 * Clearly labeled in the UI as "rule-based" so demos stay honest.
 *
 * The lead scorer lives in ./lead-score so the demo seed can import it
 * without this file's `server-only` marker; it is re-exported here so every
 * existing caller is unchanged.
 */

export { heuristicLeadScore } from "./lead-score";

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
  // baseValue, not value: the deals may be in different currencies, and the
  // line below sums them. This rendered the raw entered amounts under a
  // hardcoded "$" — EUR 9,600 and USD 48,000 became "$57,600".
  openDeals: { title: string; baseValue: number; stage: string }[];
  recentActivities: { type: string; content: string; createdAt: Date }[];
}): string {
  const lines: string[] = [];
  lines.push(
    `${input.name} is a ${input.status.toLowerCase()}${input.companyName ? ` at ${input.companyName}` : ""}.`,
  );
  if (input.openDeals.length > 0) {
    const total = input.openDeals.reduce((s, d) => s + d.baseValue, 0);
    lines.push(
      `Open pipeline: ${input.openDeals.length} deal(s) worth ${formatCurrency(total)} — ${input.openDeals
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
