/**
 * Decides which database the destructive demo reset (scripts/reset-demo.ts)
 * will touch.
 *
 * Local is the default even when Turso credentials are present, because they
 * always are — `.env` carries them for `db:push:turso`. Reaching production has
 * to be asked for, the same way `db:seed` requires SEED_REMOTE. The flag is
 * ALLOW_REMOTE_DB so it matches what createDbAdapter() already honours: below,
 * "remote" is exactly the case where the adapter will pick Turso.
 */
export function resolveResetTarget(
  env: Record<string, string | undefined> = process.env,
): "remote" | "local" {
  if (env.ALLOW_REMOTE_DB !== "true") return "local";

  if (!env.TURSO_DATABASE_URL) {
    // Opting in to a remote reset with nothing remote configured means the
    // caller's intent and the environment disagree. Failing beats quietly
    // wiping the local database instead.
    throw new Error(
      "ALLOW_REMOTE_DB=true but TURSO_DATABASE_URL is not set — refusing to guess which database to reset.",
    );
  }

  return "remote";
}

/** How long an audit entry the reset does not own survives on the demo. */
export const AUDIT_RETENTION_DAYS = 30;

/**
 * Which audit rows the nightly demo reset may delete.
 *
 * It used to delete all of them. AuditLog has no foreign key into the CRM
 * tables — `entityId` is a plain string — so it never needed clearing for the
 * ordered deletes around it to succeed, and wiping it gave the "full audit
 * trail" the Settings page advertises a maximum retention of 24 hours. Real
 * users' logins, changes and AI usage went with it, so any incident noticed
 * the next morning had nothing left to investigate.
 *
 * Now: entries authored by the demo account go, because they describe records
 * this reset is about to delete. Everything else ages out on a retention
 * window, so the table still cannot grow without bound.
 */
export function auditPruneWhere({
  demoUserId,
  now,
  retentionDays = AUDIT_RETENTION_DAYS,
}: {
  demoUserId: string | null;
  now: Date;
  retentionDays?: number;
}) {
  const cutoff = new Date(now.getTime() - retentionDays * 86400_000);
  const clauses: Array<Record<string, unknown>> = [
    { createdAt: { lt: cutoff } },
  ];
  if (demoUserId) clauses.push({ userId: demoUserId });
  return { OR: clauses };
}
