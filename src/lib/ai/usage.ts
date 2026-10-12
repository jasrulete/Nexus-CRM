import "server-only";
import * as Sentry from "@sentry/nextjs";
import { limitsFor } from "@/lib/plans";
import { CHARGED_AI_OUTCOMES, aiCallsToday } from "@/lib/system-queries";
import { workspaceMode } from "@/lib/workspace-mode";
import type { WorkspaceContext } from "@/lib/workspace-context";

/**
 * The AI usage ledger (spec §7). One AiUsage row per metered action, written
 * through the workspace-scoped client:
 *
 *   1. The monthly allowance (multi mode only). This UTC month's charged rows
 *      are counted; at the plan's limit a "denied" row is written and the
 *      caller gets a plain message. No call is made.
 *   2. The daily ceiling (any mode, when AI_DAILY_CEILING is set). Charged
 *      rows since 00:00 UTC across every workspace (aiCallsToday). At the
 *      ceiling a "capacity" row is written and the caller answers with its
 *      heuristic under the capacity label.
 *   3. A "pending" row is inserted BEFORE the provider call, so concurrent
 *      requests see it. The overshoot is bounded by the number in flight.
 *   4. After the call, settleAiCall records answered / rejected / fallback,
 *      the provider and the tokens.
 */

export type AiAction = "score" | "summary" | "draft";
export type AiOutcome = "pending" | "answered" | "rejected" | "fallback" | "capacity" | "denied";
export type AiReservation =
  | { kind: "go"; usageId: string }
  | { kind: "denied"; message: string }
  | { kind: "capacity" };

// The allowance charges CHARGED_AI_OUTCOMES (pending, answered, rejected),
// imported from system-queries.ts so it counts exactly the rows the daily
// ceiling counts in aiCallsToday. "fallback" (no provider output: a 429, an
// error, a timeout, no key), "capacity" and "denied" are never charged. A
// workspace doesn't pay for an outage or for another tenant's use. A row
// left "pending" by a killed function stays counted, which fails closed.

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * AI_DAILY_CEILING: unset or blank means no ceiling, which is the self-host
 * default. A value that isn't a whole number fails closed, as 0. The
 * mistake then shows up as the capacity label on every AI action, not as
 * the unlimited spend it would otherwise allow.
 */
function dailyCeiling(): number | null {
  const raw = process.env.AI_DAILY_CEILING?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  console.error(`AI_DAILY_CEILING must be a whole number, got "${raw}"; treating it as 0`);
  return 0;
}

function allowanceMessage(limit: number): string {
  return `This workspace has used its ${limit} AI actions for this month. They reset on the 1st (UTC), or upgrade for more.`;
}

function record(ctx: WorkspaceContext, action: AiAction, outcome: AiOutcome, now: Date) {
  return ctx.db.aiUsage.create({
    data: {
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      action,
      outcome,
      createdAt: now,
    },
    select: { id: true },
  });
}

export async function reserveAiCall(
  ctx: WorkspaceContext,
  action: AiAction,
  now: Date = new Date(),
): Promise<AiReservation> {
  const limits = limitsFor(workspaceMode(), ctx.plan);
  if (limits) {
    const used = await ctx.db.aiUsage.count({
      // Spread: the shared tuple is readonly, and Prisma's `in` takes a mutable string[].
      where: { outcome: { in: [...CHARGED_AI_OUTCOMES] }, createdAt: { gte: startOfUtcMonth(now) } },
    });
    if (used >= limits.aiActionsPerMonth) {
      await record(ctx, action, "denied", now);
      return { kind: "denied", message: allowanceMessage(limits.aiActionsPerMonth) };
    }
  }

  const ceiling = dailyCeiling();
  if (ceiling !== null && (await aiCallsToday(now)) >= ceiling) {
    await record(ctx, action, "capacity", now);
    return { kind: "capacity" };
  }

  const row = await record(ctx, action, "pending", now);
  return { kind: "go", usageId: row.id };
}

/**
 * Best-effort, like audit(): the answer has already been produced, and losing
 * it over a ledger write would help nobody. A row that fails to settle stays
 * "pending", which is charged, so the failure errs on the safe side.
 */
export async function settleAiCall(
  ctx: WorkspaceContext,
  usageId: string,
  settle: {
    outcome: "answered" | "rejected" | "fallback";
    provider: string | null;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  try {
    await ctx.db.aiUsage.update({
      where: { id: usageId },
      data: {
        outcome: settle.outcome,
        provider: settle.provider,
        inputTokens: settle.inputTokens,
        outputTokens: settle.outputTokens,
      },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { subsystem: "ai-usage" },
      extra: { usageId, outcome: settle.outcome },
    });
    console.error("AI usage settle failed", err);
  }
}
