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
