/**
 * The M1 verify gate is what stands between a migration and production
 * traffic (spec §10), so each check is shown failing on the defect it exists
 * to catch, not only passing on a good database.
 *
 * The databases here replay the three pre-M1 migrations and then a stand-in
 * for M1's shape (FAKE_M1), so these tests do not depend on plan Task 3. The
 * checks read only the tables and columns FAKE_M1 creates.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  backupArgsError,
  checkM1,
  describeTarget,
  dumpDatabase,
  parseCliArgs,
  queryFrom,
  rowCounts,
  schemaShape,
  type CheckResult,
  type M1CheckOptions,
  type Query,
  type Row,
} from "./migration-checks";

const BASE = [
  "20260715164036_init",
  "20260725150849_add_deal_task_fk_indexes",
  "20260823151943_add_deal_base_value_and_fx_rate",
];
const LEDGER = [...BASE, "fake_m1"];
const T = "2026-01-01T00:00:00.000+00:00";

const FAKE_M1 = `
CREATE TABLE "Workspace" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "isDemo" BOOLEAN NOT NULL DEFAULT false, "plan" TEXT NOT NULL DEFAULT 'FREE', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL);
CREATE TABLE "Membership" ("id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL, "role" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "AiUsage" ("id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL);
ALTER TABLE "Company" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Deal" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Task" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "workspaceId" TEXT;
`;

const FIXTURES = `
INSERT INTO "User" ("id", "email", "name", "passwordHash", "role", "createdAt", "updatedAt") VALUES
  ('u_admin', 'admin@example.com', 'Ada Admin', 'x', 'ADMIN', '${T}', '${T}'),
  ('u_member', 'member@example.com', 'Mo Member', 'x', 'MEMBER', '${T}', '${T}');
INSERT INTO "Workspace" ("id", "name", "slug", "createdAt", "updatedAt") VALUES ('ws_default', 'Default workspace', 'default', '${T}', '${T}');
INSERT INTO "Membership" ("id", "workspaceId", "userId", "role", "createdAt") VALUES
  ('mem_u_admin', 'ws_default', 'u_admin', 'ADMIN', '${T}'),
  ('mem_u_member', 'ws_default', 'u_member', 'MEMBER', '${T}');
INSERT INTO "Company" ("id", "name", "ownerId", "updatedAt", "workspaceId") VALUES ('co_1', 'Acme', 'u_admin', '${T}', 'ws_default');
INSERT INTO "Contact" ("id", "firstName", "lastName", "companyId", "ownerId", "updatedAt", "workspaceId") VALUES ('ct_1', 'Cy', 'One', 'co_1', 'u_admin', '${T}', 'ws_default');
INSERT INTO "Deal" ("id", "title", "contactId", "companyId", "ownerId", "updatedAt", "workspaceId") VALUES ('dl_1', 'Renewal', 'ct_1', 'co_1', 'u_member', '${T}', 'ws_default');
INSERT INTO "Activity" ("id", "type", "content", "contactId", "userId", "workspaceId") VALUES ('ac_1', 'NOTE', 'Called', 'ct_1', 'u_admin', 'ws_default');
INSERT INTO "Task" ("id", "title", "dealId", "assigneeId", "workspaceId") VALUES ('tk_1', 'Send the quote', 'dl_1', 'u_member', 'ws_default');
INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "userId", "workspaceId") VALUES
  ('al_1', 'auth.login', 'User', 'u_admin', 'u_admin', NULL),
  ('al_2', 'contact.create', 'Contact', 'ct_1', 'u_admin', 'ws_default');
CREATE TABLE "_turso_migrations" (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT INTO "_turso_migrations" (name, applied_at) VALUES
  ('20260715164036_init', '${T}'),
  ('20260725150849_add_deal_task_fk_indexes', '${T}'),
  ('20260823151943_add_deal_base_value_and_fx_rate', '${T}'),
  ('fake_m1', '${T}');
`;

const open: Database.Database[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function readMigration(name: string): string {
  return readFileSync(join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8");
}

/** The three pre-M1 migrations, then FAKE_M1, then (optionally) data and a Turso ledger. */
function build(withData: boolean): Database.Database {
  const db = new Database(":memory:");
  open.push(db);
  for (const name of BASE) db.exec(readMigration(name));
  db.exec(FAKE_M1);
  if (withData) db.exec(FIXTURES);
  return db;
}

const query =
  (db: Database.Database): Query =>
  async (sql) =>
    db.prepare(sql).all() as Row[];

async function verdict(live: Database.Database, overrides: Partial<M1CheckOptions> = {}): Promise<Record<string, CheckResult>> {
  const checks = await checkM1(query(live), {
    reference: query(build(false)),
    migrationNames: LEDGER,
    backupCounts: null,
    ...overrides,
  });
  return Object.fromEntries(checks.map((c) => [c.name, c]));
}

describe("checkM1", () => {
  it("passes on a correctly migrated database, running every check in order", async () => {
    const checks = await checkM1(query(build(true)), {
      reference: query(build(false)),
      migrationNames: LEDGER,
      backupCounts: { User: 2, Session: 0, Company: 1, Contact: 1, Deal: 1, Activity: 1, Task: 1, AuditLog: 2, _turso_migrations: 3 },
    });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual([
      "new tables",
      "workspace iff user",
      "one membership per user, role copied",
      "no null workspaceId outside auth.* audit rows",
      "auth.* audit rows stay platform rows",
      "no drift from prisma/migrations",
      "foreign_key_check is empty",
      "ledger complete",
      "CRM row counts equal the backup",
    ]);
  });

  it("stops at the first check on a database M1 has not reached", async () => {
    const db = new Database(":memory:");
    open.push(db);
    for (const name of BASE) db.exec(readMigration(name));
    const checks = await checkM1(query(db), { reference: query(db), migrationNames: LEDGER, backupCounts: null });
    expect(checks).toEqual([{ name: "new tables", ok: false, detail: "missing: Workspace, Membership, AiUsage" }]);
  });

  it("fails when a user has no membership", async () => {
    const live = build(true);
    live.exec(`DELETE FROM "Membership" WHERE "userId" = 'u_member'`);
    expect((await verdict(live))["one membership per user, role copied"]?.ok).toBe(false);
  });

  it("fails when a role was not copied as is", async () => {
    const live = build(true);
    live.exec(`UPDATE "Membership" SET "role" = 'OWNER' WHERE "userId" = 'u_admin'`);
    expect((await verdict(live))["one membership per user, role copied"]?.ok).toBe(false);
  });

  it("fails when a CRM row has no workspace", async () => {
    const live = build(true);
    live.exec(`UPDATE "Deal" SET "workspaceId" = NULL`);
    const check = (await verdict(live))["no null workspaceId outside auth.* audit rows"];
    expect(check?.ok).toBe(false);
    expect(check?.detail).toBe("Deal=1");
  });

  it("fails on a non-auth audit row with no workspace, but never on an auth row", async () => {
    const live = build(true);
    live.exec(`UPDATE "AuditLog" SET "workspaceId" = NULL WHERE "id" = 'al_2'`);
    expect((await verdict(live))["no null workspaceId outside auth.* audit rows"]?.ok).toBe(false);
    // al_1 (auth.login) is NULL in the fixtures and the check passes there.
    expect((await verdict(build(true)))["no null workspaceId outside auth.* audit rows"]?.ok).toBe(true);
  });

  it("fails when an auth.* row was given a workspace", async () => {
    const live = build(true);
    live.exec(`UPDATE "AuditLog" SET "workspaceId" = 'ws_default' WHERE "id" = 'al_1'`);
    expect((await verdict(live))["auth.* audit rows stay platform rows"]?.ok).toBe(false);
  });

  it("fails when users exist but no workspace does", async () => {
    const live = build(true);
    live.exec(`DELETE FROM "Workspace"`);
    expect((await verdict(live))["workspace iff user"]?.ok).toBe(false);
  });

  it("fails when a workspace exists with no users", async () => {
    const live = build(false);
    live.exec(`INSERT INTO "Workspace" ("id", "name", "slug", "createdAt", "updatedAt") VALUES ('ws_default', 'Default workspace', 'default', '${T}', '${T}')`);
    expect((await verdict(live))["workspace iff user"]?.ok).toBe(false);
  });

  it("reports drift and names what differs", async () => {
    const live = build(true);
    live.exec(`DROP INDEX "Contact_ownerId_idx"`);
    const check = (await verdict(live))["no drift from prisma/migrations"];
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("Contact: missing index Contact_ownerId_idx");
  });

  it("fails on a ledger row that was claimed but never finished", async () => {
    const live = build(true);
    live.exec(`UPDATE "_turso_migrations" SET "applied_at" = '' WHERE "name" = 'fake_m1'`);
    const check = (await verdict(live))["ledger complete"];
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("unfinished fake_m1");
  });

  it("fails when a migration directory never reached the ledger", async () => {
    const check = (await verdict(build(true), { migrationNames: [...LEDGER, "20991231000000_future"] }))["ledger complete"];
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("never applied 20991231000000_future");
  });

  it("fails when there is no ledger at all", async () => {
    const live = build(true);
    live.exec(`DROP TABLE "_turso_migrations"`);
    const check = (await verdict(live))["ledger complete"];
    expect(check?.ok).toBe(false);
    expect(check?.detail).toBe("no _turso_migrations, _docker_migrations or _prisma_migrations table");
  });

  it("reads a Prisma Migrate ledger, ignoring attempts that were rolled back", async () => {
    const live = build(true);
    live.exec(`
      DROP TABLE "_turso_migrations";
      CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp, "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0);
    `);
    const insert = live.prepare(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "rolled_back_at") VALUES (?, 'x', ?, ?, ?)`,
    );
    LEDGER.forEach((name, i) => insert.run(`m${i}`, T, name, null));
    // An earlier failed attempt, resolved with `prisma migrate resolve --rolled-back`.
    insert.run("resolved", null, "fake_m1", T);
    expect((await verdict(live))["ledger complete"]?.ok).toBe(true);
    // A failed attempt nobody resolved: migrate deploy would refuse, so must the gate.
    insert.run("stuck", null, "fake_m1", null);
    expect((await verdict(live))["ledger complete"]?.ok).toBe(false);
  });

  it("compares only the CRM tables' row counts with the backup", async () => {
    const live = build(true);
    const crm = { Company: 1, Contact: 1, Deal: 1, Activity: 1, Task: 1 };
    // Sign-ups, logins and audit rows land while the old build is still serving,
    // and the ledger gains M1's own row: none of them is compared.
    const grown = { ...crm, User: 0, Session: 7, AuditLog: 0, _turso_migrations: 0 };
    expect((await verdict(live, { backupCounts: grown }))["CRM row counts equal the backup"]).toEqual({
      name: "CRM row counts equal the backup",
      ok: true,
      detail: "5 CRM table(s) match",
    });
    const changed = (await verdict(live, { backupCounts: { ...crm, Company: 2 } }))["CRM row counts equal the backup"];
    expect(changed?.ok).toBe(false);
    expect(changed?.detail).toBe("Company 2 -> 1");
  });

  it("skips the row-count check when there is no backup", async () => {
    const checks = await verdict(build(true));
    expect(checks["CRM row counts equal the backup"]).toBeUndefined();
    expect(Object.values(checks).filter((c) => !c.ok)).toEqual([]);
    expect(Object.keys(checks)).toHaveLength(8);
  });
});

describe("dumpDatabase and rowCounts", () => {
  it("dumps every app table with its columns and rows, and skips SQLite's own tables", async () => {
    const db = build(true);
    db.exec(`CREATE TABLE "Counter" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT); INSERT INTO "Counter" ("label") VALUES ('a');`);
    const backup = await dumpDatabase(query(db), "file:./test.db", new Date("2026-10-11T00:00:00Z"));
    expect(backup.takenAt).toBe("2026-10-11T00:00:00.000Z");
    expect(backup.target).toBe("file:./test.db");
    expect(Object.keys(backup.data)).not.toContain("sqlite_sequence");
    expect(backup.data.Counter).toEqual({ columns: ["id", "label"], rows: [{ id: 1, label: "a" }] });
    expect(backup.schema.some((r) => r.name === "Contact_ownerId_idx")).toBe(true);
    expect(rowCounts(backup)).toMatchObject({ User: 2, Company: 1, _turso_migrations: 4, Counter: 1 });
  });
});

describe("schemaShape", () => {
  it("describes a composite foreign key as one key", async () => {
    const db = new Database(":memory:");
    open.push(db);
    db.exec(`
      CREATE TABLE "P" ("a" TEXT NOT NULL, "b" TEXT NOT NULL, UNIQUE ("a", "b"));
      CREATE TABLE "C" ("x" TEXT, "y" TEXT, FOREIGN KEY ("x", "y") REFERENCES "P" ("a", "b") ON DELETE NO ACTION);
    `);
    const shape = await schemaShape(query(db));
    expect(shape.C).toContain("foreign key (x, y) -> P(a, b) on update NO ACTION on delete NO ACTION");
  });
});

describe("queryFrom", () => {
  it("turns libSQL-style array rows into objects", async () => {
    const q = queryFrom(async () => ({ columns: ["id", "n"], rows: [["a", 1], ["b", 2]] }));
    expect(await q("SELECT 1")).toEqual([
      { id: "a", n: 1 },
      { id: "b", n: 2 },
    ]);
  });
});

describe("describeTarget", () => {
  it("never keeps credentials or a query string", () => {
    expect(describeTarget("libsql://db-org.turso.io?authToken=secret")).toBe("libsql://db-org.turso.io");
    expect(describeTarget("libsql://user:pw@db-org.turso.io")).toBe("libsql://db-org.turso.io");
    expect(describeTarget("file:./.scratch/x.db")).toBe("file:./.scratch/x.db");
  });
});

/**
 * scripts/backup-turso.ts falls back to TURSO_DATABASE_URL (production at
 * rollout) when it sees no --url, so every argument shape that is not exactly
 * "<label> [--url <value>]" must be refused rather than read as "no --url".
 */
describe("backupArgsError", () => {
  it.each([
    [["pre-m1"]],
    [["pre-m1", "--url", "file:./x.db"]],
    [["--url", "file:.scratch/x.db", "pre-m1"]],
    [["pre-m1", "--url", "libsql://db-org.turso.io"]],
  ])("accepts %j", (argv) => {
    expect(backupArgsError(argv)).toBeNull();
  });

  it.each([
    ["a typo'd flag (--urll)", ["pre-m1", "--urll", "file:./x.db"]],
    ["a typo'd flag (--ulr)", ["pre-m1", "--ulr", "file:./x.db"]],
    ["the wrong case (--URL)", ["pre-m1", "--URL", "file:./x.db"]],
    ["a single dash (-url)", ["pre-m1", "-url", "file:./x.db"]],
    ["--url=value, which parseCliArgs reads as one unknown flag", ["pre-m1", "--url=file:./x.db"]],
    ["a database path with the flag forgotten", ["pre-m1", "file:./x.db"]],
    ["no label at all", []],
    ["no label, only --url", ["--url", "file:./x.db"]],
    ["two labels", ["pre-m1", "post-m1"]],
    ["--url with no value", ["pre-m1", "--url"]],
    ["--url with an empty value", ["pre-m1", "--url", ""]],
    ["a stray extra flag beside a valid --url", ["pre-m1", "--url", "file:./x.db", "--backup", "b.json"]],
    ["a label with a space", ["bad label"]],
    ["a label starting with a dash", ["-pre-m1"]],
  ])("refuses %s, so it can never fall back to TURSO_DATABASE_URL", (_name, argv) => {
    expect(backupArgsError(argv)).toContain("Usage: npx tsx scripts/backup-turso.ts <label>");
  });
});

describe("parseCliArgs", () => {
  it("splits positionals from --flag value pairs", () => {
    expect(parseCliArgs(["pre-m1", "--url", "file:./x.db"])).toEqual({ positional: ["pre-m1"], flags: { url: "file:./x.db" } });
    expect(parseCliArgs(["--backup", "b.json"])).toEqual({ positional: [], flags: { backup: "b.json" } });
  });
});
