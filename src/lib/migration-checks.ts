/**
 * Read-only database checks behind the migration tooling (spec §10, phase A;
 * multi-tenancy plan Task 2). scripts/backup-turso.ts dumps a database with
 * `dumpDatabase`; scripts/verify-m1.ts runs `checkM1` after M1 and, given
 * --backup, compares the CRM tables' row counts with that dump.
 *
 * Everything works through a `Query` function rather than a driver, so the
 * same code runs against Turso (@libsql/client) in production and against
 * better-sqlite3 in tests: the same split as migration-ledger.ts. Nothing
 * here writes.
 */

export type Row = Record<string, unknown>;
/** Runs one read-only statement and returns its rows as plain objects. */
export type Query = (sql: string) => Promise<Row[]>;
export type CheckResult = { name: string; ok: boolean; detail: string };

/** A logical backup: sqlite_master plus every table's columns and rows. */
export type Backup = {
  takenAt: string;
  target: string;
  schema: Row[];
  data: Record<string, { columns: string[]; rows: Row[] }>;
};

export type M1CheckOptions = {
  /** A database built by replaying prisma/migrations; the live schema must match it. */
  reference: Query;
  /** Every directory in prisma/migrations. null skips the ledger check (tests only). */
  migrationNames: string[] | null;
  /**
   * Row counts from the backup taken just before M1. Only the CRM tables are
   * compared. null skips the comparison (verify-m1 without --backup, and tests).
   */
  backupCounts: Record<string, number> | null;
};

/**
 * The id M1 gives the default workspace. It must equal DEFAULT_WORKSPACE_ID in
 * src/lib/workspace-bootstrap.ts (plan Task 4); the M1 SQL hard-codes it too.
 */
export const M1_DEFAULT_WORKSPACE_ID = "ws_default";

const LEDGER_TABLES = ["_turso_migrations", "_docker_migrations", "_prisma_migrations"];
const M1_TABLES = ["Workspace", "Membership", "AiUsage"];
const CRM_TABLES = ["Company", "Contact", "Deal", "Activity", "Task"];

/** SQLite's own tables and libSQL's bookkeeping are never app data. */
function isInternal(table: string): boolean {
  return table.startsWith("sqlite_") || table.startsWith("libsql_") || table.startsWith("_litestream");
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function tableNames(q: Query): Promise<string[]> {
  const rows = await q(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`);
  return rows.map((r) => String(r.name)).filter((name) => !isInternal(name));
}

async function count(q: Query, sql: string): Promise<number> {
  const [row] = await q(sql);
  return Number(row?.n);
}

/**
 * Adapts anything shaped like @libsql/client's `execute` (column names plus
 * array-like rows) to a `Query`. Values pass through untouched.
 */
export function queryFrom(
  execute: (sql: string) => Promise<{ columns: string[]; rows: ArrayLike<unknown>[] }>,
): Query {
  return async (sql) => {
    const result = await execute(sql);
    return result.rows.map((row) =>
      Object.fromEntries(result.columns.map((column, i) => [column, row[i]])),
    );
  };
}

/** `a --flag value b` → positional [a, b], flags { flag: value }. */
export function parseCliArgs(argv: string[]): { positional: string[]; flags: Partial<Record<string, string>> } {
  const positional: string[] = [];
  const flags: Partial<Record<string, string>> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      flags[arg.slice(2)] = argv[i + 1] ?? "";
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** The target with no credentials and no query string, safe to print and store. */
export function describeTarget(url: string): string {
  return url.replace(/[?#].*$/, "").replace(/\/\/[^/@]*@/, "//");
}

/** Every non-internal table (the migration ledgers included), with its columns and rows. */
export async function dumpDatabase(q: Query, target: string, now: Date = new Date()): Promise<Backup> {
  const schema = await q(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`);
  const data: Backup["data"] = {};
  for (const table of await tableNames(q)) {
    const columns = (await q(`PRAGMA table_info(${quote(table)})`)).map((c) => String(c.name));
    data[table] = { columns, rows: await q(`SELECT * FROM ${quote(table)}`) };
  }
  return { takenAt: now.toISOString(), target, schema, data };
}

export function rowCounts(backup: Backup): Record<string, number> {
  return Object.fromEntries(Object.entries(backup.data).map(([table, d]) => [table, d.rows.length]));
}

/**
 * A driver-independent description of every app table: columns, indexes and
 * foreign keys, read from PRAGMAs rather than the stored DDL text, so two
 * databases built by the same migrations compare equal however each runner
 * applied them. The migration ledgers are left out: each runner keeps its own.
 */
export async function schemaShape(q: Query): Promise<Record<string, string[]>> {
  const shape: Record<string, string[]> = {};
  for (const table of await tableNames(q)) {
    if (LEDGER_TABLES.includes(table)) continue;
    const lines: string[] = [];
    for (const c of await q(`PRAGMA table_info(${quote(table)})`)) {
      lines.push(`column ${String(c.name)} ${String(c.type)} notnull=${String(c.notnull)} default=${String(c.dflt_value ?? "none")} pk=${String(c.pk)}`);
    }
    const indexes = (await q(`PRAGMA index_list(${quote(table)})`)).map((i) => ({ name: String(i.name), unique: String(i.unique) }));
    indexes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const index of indexes) {
      const columns = (await q(`PRAGMA index_info(${quote(index.name)})`))
        .sort((a, b) => Number(a.seqno) - Number(b.seqno))
        .map((c) => String(c.name));
      lines.push(`index ${index.name} unique=${index.unique} (${columns.join(", ")})`);
    }
    const keys = new Map<number, Row[]>();
    for (const fk of await q(`PRAGMA foreign_key_list(${quote(table)})`)) {
      const id = Number(fk.id);
      keys.set(id, [...(keys.get(id) ?? []), fk]);
    }
    const keyLines = [...keys.values()].map((parts) => {
      parts.sort((a, b) => Number(a.seq) - Number(b.seq));
      const first = parts[0];
      return `foreign key (${parts.map((p) => String(p.from)).join(", ")}) -> ${String(first.table)}(${parts.map((p) => String(p.to)).join(", ")}) on update ${String(first.on_update)} on delete ${String(first.on_delete)}`;
    });
    lines.push(...keyLines.sort());
    shape[table] = lines;
  }
  return shape;
}

function describeDrift(live: Record<string, string[]>, reference: Record<string, string[]>): string[] {
  const problems: string[] = [];
  const tables = [...new Set([...Object.keys(live), ...Object.keys(reference)])].sort();
  for (const table of tables) {
    const actual = live[table];
    const expected = reference[table];
    if (!actual) {
      problems.push(`${table}: missing from the database`);
      continue;
    }
    if (!expected) {
      problems.push(`${table}: not created by the migrations`);
      continue;
    }
    const missing = expected.filter((line) => !actual.includes(line));
    const unexpected = actual.filter((line) => !expected.includes(line));
    for (const line of missing) problems.push(`${table}: missing ${line}`);
    for (const line of unexpected) problems.push(`${table}: unexpected ${line}`);
    if (!missing.length && !unexpected.length && actual.join("\n") !== expected.join("\n")) {
      problems.push(`${table}: column order differs`);
    }
  }
  return problems;
}

type LedgerEntry = { name: string; state: "applied" | "pending" | "rolled-back" };

/** The first runner ledger found: Turso runner, Docker runner, then Prisma Migrate. */
async function readLedger(q: Query): Promise<{ table: string; entries: LedgerEntry[] } | null> {
  const present = (await q(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => String(r.name));
  for (const table of ["_turso_migrations", "_docker_migrations"]) {
    if (!present.includes(table)) continue;
    const rows = await q(`SELECT name, applied_at FROM ${quote(table)}`);
    return {
      table,
      entries: rows.map((r) => ({
        name: String(r.name),
        state: String(r.applied_at ?? "").trim() !== "" ? "applied" : "pending",
      })),
    };
  }
  if (present.includes("_prisma_migrations")) {
    const rows = await q(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`);
    return {
      table: "_prisma_migrations",
      entries: rows.map((r) => ({
        name: String(r.migration_name),
        state: r.rolled_back_at != null ? "rolled-back" : r.finished_at != null ? "applied" : "pending",
      })),
    };
  }
  return null;
}

/**
 * The M1 checks from spec §10 phase A, plus the safety checks the recovered
 * verify-migration.cjs ran: the ledger, foreign_key_check and (with a backup)
 * the CRM tables' row counts. Returns early, with only the first check, when
 * M1's tables do not exist.
 */
export async function checkM1(live: Query, options: M1CheckOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const check = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });
  const ws = M1_DEFAULT_WORKSPACE_ID;
  const tables = await tableNames(live);

  const missing = M1_TABLES.filter((t) => !tables.includes(t));
  check("new tables", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "Workspace, Membership, AiUsage present");
  if (missing.length) return results;

  const users = await count(live, `SELECT COUNT(*) AS n FROM "User"`);
  const workspaces = (await live(`SELECT "id" FROM "Workspace" ORDER BY "id"`)).map((r) => String(r.id));
  check(
    "workspace iff user",
    users === 0 ? workspaces.length === 0 : workspaces.length === 1 && workspaces[0] === ws,
    `${users} user(s); workspaces: ${workspaces.join(", ") || "none"}`,
  );

  const memberships = await count(live, `SELECT COUNT(*) AS n FROM "Membership"`);
  const wrong = await count(
    live,
    `SELECT COUNT(*) AS n FROM "User" u LEFT JOIN "Membership" m ON m."userId" = u."id"
     WHERE m."id" IS NULL OR m."workspaceId" <> '${ws}' OR m."role" <> u."role"`,
  );
  check(
    "one membership per user, role copied",
    memberships === users && wrong === 0,
    `${users} user(s), ${memberships} membership(s), ${wrong} missing or mismatched`,
  );

  const nulls: string[] = [];
  for (const table of CRM_TABLES) {
    const n = await count(live, `SELECT COUNT(*) AS n FROM ${quote(table)} WHERE "workspaceId" IS NULL`);
    if (n) nulls.push(`${table}=${n}`);
  }
  const auditNulls = await count(live, `SELECT COUNT(*) AS n FROM "AuditLog" WHERE "workspaceId" IS NULL AND "action" NOT LIKE 'auth.%'`);
  if (auditNulls) nulls.push(`AuditLog (non-auth)=${auditNulls}`);
  check("no null workspaceId outside auth.* audit rows", nulls.length === 0, nulls.join(", ") || "none");

  const stampedAuth = await count(live, `SELECT COUNT(*) AS n FROM "AuditLog" WHERE "action" LIKE 'auth.%' AND "workspaceId" IS NOT NULL`);
  check("auth.* audit rows stay platform rows", stampedAuth === 0, `${stampedAuth} auth row(s) carry a workspace`);

  const drift = describeDrift(await schemaShape(live), await schemaShape(options.reference));
  check("no drift from prisma/migrations", drift.length === 0, drift.slice(0, 5).join("; ") || "schema matches");

  const violations = (await live(`PRAGMA foreign_key_check`)).length;
  check("foreign_key_check is empty", violations === 0, `${violations} violation(s)`);

  if (options.migrationNames) {
    const ledger = await readLedger(live);
    if (!ledger) {
      check("ledger complete", false, "no _turso_migrations, _docker_migrations or _prisma_migrations table");
    } else {
      const unfinished = ledger.entries.filter((e) => e.state === "pending").map((e) => e.name);
      const neverApplied = options.migrationNames.filter(
        (name) => !ledger.entries.some((e) => e.name === name && e.state === "applied"),
      );
      const ok = unfinished.length === 0 && neverApplied.length === 0;
      check(
        "ledger complete",
        ok,
        ok
          ? `${ledger.table}: all ${options.migrationNames.length} applied`
          : `${ledger.table}: unfinished ${unfinished.join(", ") || "none"}; never applied ${neverApplied.join(", ") || "none"}`,
      );
    }
  }

  if (options.backupCounts) {
    // CRM tables only. User, Session and AuditLog grow with live traffic
    // (sign-ups, logins) between the backup and this run, and every ledger
    // gains M1's own row, so none of those is ever compared.
    const changed: string[] = [];
    for (const table of CRM_TABLES) {
      const expected: number | undefined = options.backupCounts[table];
      const actual = await count(live, `SELECT COUNT(*) AS n FROM ${quote(table)}`);
      if (actual !== expected) changed.push(`${table} ${expected ?? "absent"} -> ${actual}`);
    }
    check(
      "CRM row counts equal the backup",
      changed.length === 0,
      changed.join(", ") || `${CRM_TABLES.length} CRM table(s) match`,
    );
  }

  return results;
}
