export const DEAL_STAGES = [
  "LEAD",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const STAGE_LABELS: Record<DealStage, string> = {
  LEAD: "Lead",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

/**
 * Probability a deal in each stage eventually closes won, used for the
 * weighted forecast on the dashboard and each kanban column.
 *
 * Deliberately a constant per stage rather than a column on Deal: a per-deal
 * override is a real feature with a migration and a form field behind it, and
 * nothing has asked for one. These are the conventional defaults a CRM ships
 * with, and the number they produce is honest as long as it is labelled as
 * stage-based rather than as a model's prediction.
 */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  LEAD: 0.1,
  QUALIFIED: 0.25,
  PROPOSAL: 0.5,
  NEGOTIATION: 0.75,
  WON: 1,
  LOST: 0,
};

/**
 * Expected value of a set of deals, weighted by each one's stage.
 *
 * Takes `baseValue` — the amount converted to the workspace currency — because
 * this is a sum, and amounts in different currencies cannot be added.
 */
export function weightedValue(
  deals: { stage: string; baseValue: number }[],
): number {
  return Math.round(
    deals.reduce(
      (sum, d) =>
        sum + d.baseValue * (STAGE_PROBABILITY[d.stage as DealStage] ?? 0),
      0,
    ),
  );
}

/** Open (in-play) stages shown as kanban columns, in order. */
export const OPEN_STAGES: DealStage[] = [
  "LEAD",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
];

export const CONTACT_STATUSES = [
  "LEAD",
  "QUALIFIED",
  "CUSTOMER",
  "CHURNED",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  LEAD: "Lead",
  QUALIFIED: "Qualified",
  CUSTOMER: "Customer",
  CHURNED: "Churned",
};

export const ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  NOTE: "Note",
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
};

export const CONTACT_SOURCES = [
  "website",
  "referral",
  "outbound",
  "event",
  "other",
] as const;

export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
] as const;

export const USER_ROLES = ["ADMIN", "MEMBER"] as const;
export type UserRole = (typeof USER_ROLES)[number];
