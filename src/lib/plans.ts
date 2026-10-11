import type { WorkspaceContext } from "./workspace-context";
import { workspaceMode, type WorkspaceMode } from "./workspace-mode";

export type Plan = "FREE" | "PAID";

export type PlanLimits = {
  members: number;
  contacts: number;
  companies: number;
  deals: number;
  aiActionsPerMonth: number;
};

/**
 * Every plan number lives here (spec §7). Spec 3's billing only flips
 * Workspace.plan and never edits these.
 *
 * The numbers are big enough to evaluate the product properly and run a solo
 * pipeline, and small enough that a team outgrows them. Deals count every
 * stage, closed ones included.
 */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { members: 1, contacts: 200, companies: 100, deals: 100, aiActionsPerMonth: 30 },
  PAID: { members: 10, contacts: 10_000, companies: 5_000, deals: 5_000, aiActionsPerMonth: 600 },
};

/**
 * Returns null in single mode: self-host and the public demo are free and
 * unlimited. In multi mode it returns the plan's limits, and an unknown plan
 * string is held to FREE rather than left unlimited.
 */
export function limitsFor(mode: WorkspaceMode, plan: string): PlanLimits | null {
  if (mode === "single") return null;
  return plan === "PAID" ? PLAN_LIMITS.PAID : PLAN_LIMITS.FREE;
}

export type CappedKind = "contacts" | "companies" | "deals";

/** Shown in the create form, so it is phrased for the person reading it. */
export function capMessage(kind: CappedKind, limit: number): string {
  return `Your plan allows ${limit.toLocaleString("en-US")} ${kind}. Delete some or upgrade to add more.`;
}

/**
 * Returns null when the workspace may add one more record of `kind`, otherwise
 * the message to show.
 *
 * The check is a count through the scoped client, and the caller then creates.
 * Neither step runs inside an interactive transaction (spec §5.2, §7).
 * Concurrent creates can overshoot by the number in flight, and that small
 * overshoot is accepted.
 */
export async function checkRecordCap(
  ctx: WorkspaceContext,
  kind: CappedKind,
): Promise<string | null> {
  const limits = limitsFor(workspaceMode(), ctx.plan);
  if (!limits) return null;

  const count =
    kind === "contacts"
      ? await ctx.db.contact.count()
      : kind === "companies"
        ? await ctx.db.company.count()
        : await ctx.db.deal.count();
  return count >= limits[kind] ? capMessage(kind, limits[kind]) : null;
}
