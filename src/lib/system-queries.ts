import "server-only";
import { systemDb } from "@/lib/db";

/**
 * Every read that crosses workspaces, or needs raw SQL, lives here as a named
 * function with its own test (spec §5.1). Application code never imports
 * systemDb itself, so this file is the complete list of places that can see
 * more than one workspace. Each function returns only what its caller needs.
 */

/**
 * Outcomes that used a provider call (spec §7). fallback, capacity and denied
 * made none. Exported so the monthly allowance in ai/usage.ts (Task 16) counts
 * the same rows as the daily ceiling below.
 */
export const CHARGED_AI_OUTCOMES = ["pending", "answered", "rejected"] as const;

/**
 * AI calls made since 00:00 UTC of `now`, across ALL workspaces, for the
 * deployment-wide daily ceiling (AI_DAILY_CEILING). Returns a bare number,
 * never rows or ids, so nothing about another tenant reaches the caller. The
 * range is served by the AiUsage `createdAt` index.
 */
export async function aiCallsToday(now: Date = new Date()): Promise<number> {
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return systemDb.aiUsage.count({
    // Prisma's `in` takes a mutable string[], so spread the readonly tuple.
    where: { createdAt: { gte: startOfDay }, outcome: { in: [...CHARGED_AI_OUTCOMES] } },
  });
}
