/**
 * Decides what a migration runner should do, given the ledger it finds.
 *
 * Extracted from the two runners (scripts/db-push-turso.ts for Turso,
 * scripts/docker-entrypoint.mjs for the self-host image) because this is the
 * logic that has already broken production once, and it was untested in both
 * copies. Everything here is pure so it can be.
 *
 * ## Why not just wrap each migration in a transaction
 *
 * The obvious fix for "the SQL and its ledger row are two separate writes" is
 * one transaction around both. It does not work here. Prisma generates
 * table-rebuild migrations that toggle `PRAGMA foreign_keys`, and SQLite
 * documents that pragma as a no-op inside a transaction — so wrapping would
 * silently leave foreign keys enforced during the rebuild and break the very
 * migrations that need it most.
 *
 * So instead of preventing a half-applied migration, make one impossible to
 * miss: the runner writes a row *before* applying the SQL with an empty
 * `applied_at`, and fills the timestamp in afterwards. A row with no timestamp
 * therefore means "this one was interrupted partway through", and the next run
 * stops and says so rather than guessing.
 *
 * The failure this replaces was silent: an interrupted first migration left
 * some tables created and the ledger empty, the next run saw an empty ledger
 * and an existing `User` table, concluded it was adopting a pre-existing
 * database, and baselined — so the tables that were never created never would
 * be, and the app failed at query time with "no such table".
 */

export type LedgerRow = { name: string; applied_at: string };

export type MigrationPlan =
  | { kind: "interrupted"; migration: string; message: string }
  | { kind: "baseline"; migration: string; pending: string[] }
  | { kind: "apply"; pending: string[] };

/** A ledger row counts as applied only once its timestamp is filled in. */
function isApplied(row: LedgerRow): boolean {
  return row.applied_at.trim() !== "";
}

export function planMigrations(input: {
  /** Every row currently in the ledger table. */
  ledger: LedgerRow[];
  /** Migration directory names, sorted oldest first. */
  all: string[];
  /** Whether the database already has application tables in it. */
  hasExistingSchema: boolean;
}): MigrationPlan {
  const { ledger, all, hasExistingSchema } = input;

  // Checked first, and before anything is applied: continuing past a partial
  // migration is what turns an interruption into a wedged database.
  const interrupted = ledger.find((row) => !isApplied(row));
  if (interrupted) {
    return {
      kind: "interrupted",
      migration: interrupted.name,
      message:
        `Migration "${interrupted.name}" was started but never recorded as finished, ` +
        `so the database may be halfway through it. Refusing to continue, because ` +
        `replaying it would fail on objects that already exist and skipping it ` +
        `would leave the schema incomplete. Inspect the database, finish or undo ` +
        `that migration by hand, then delete its row from the ledger.`,
    };
  }

  const applied = new Set(ledger.filter(isApplied).map((row) => row.name));

  // Adopting a database that predates the ledger: its schema is already there,
  // so record the first migration rather than replaying it. Only ever valid
  // when the ledger is completely empty — with the interrupted check above,
  // that now genuinely means "never migrated by this runner".
  if (applied.size === 0 && hasExistingSchema && all.length > 0) {
    const [first, ...rest] = all;
    return { kind: "baseline", migration: first, pending: rest };
  }

  return { kind: "apply", pending: all.filter((name) => !applied.has(name)) };
}
