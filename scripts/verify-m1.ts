/**
 * M1 verify gate (spec §10, phase A step 4). Read-only checks that M1 left the
 * database the way the spec says. Exits 1 when any check fails. The checks are
 * in src/lib/migration-checks.ts, where each one has a test that shows it failing.
 *
 * Usage, from the repo root:
 *   npx tsx scripts/verify-m1.ts [--backup <file>] [--url <libsql-url>]
 *
 *   npx tsx scripts/verify-m1.ts                                                   TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (.env)
 *   npx tsx scripts/verify-m1.ts --url file:./path.db                              any local libSQL/SQLite file
 *   npx tsx scripts/verify-m1.ts --backup backups/<file>.json [--url …]            also compares the CRM row counts
 *
 * --backup is optional. With it, the row counts of Company, Contact, Deal,
 * Activity and Task must equal the backup taken just before M1. User, Session
 * and AuditLog grow with live traffic and are never compared.
 *
 * Run it straight after M1. While the old build is still serving (before the
 * phase-A deploy), a sign-up or a new record between the backup and this run
 * shows up as a missing membership, a NULL workspaceId or a changed CRM row
 * count. Read the detail before blaming the migration. The reference schema is
 * built from this checkout's prisma/migrations, so check out the commit whose
 * migrations were applied.
 */
import "dotenv/config";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import {
  checkM1,
  describeTarget,
  parseCliArgs,
  queryFrom,
  rowCounts,
  type Backup,
  type Query,
  type Row,
} from "../src/lib/migration-checks";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const USAGE = "Usage: npx tsx scripts/verify-m1.ts [--backup <file>] [--url <libsql-url>]";
const { positional, flags } = parseCliArgs(process.argv.slice(2));
// --backup is optional, so a typo (--backups) or a missing value must not
// silently drop the row-count comparison.
const unknownFlags = Object.keys(flags).filter((flag) => flag !== "backup" && flag !== "url");
if (positional.length || unknownFlags.length || flags.backup === "" || flags.url === "") fail(USAGE);
const backupPath = flags.backup;
const url = flags.url ?? process.env.TURSO_DATABASE_URL;

if (!url) fail("TURSO_DATABASE_URL is not set and no --url was given.");
if (!existsSync(join(process.cwd(), "prisma", "migrations"))) {
  fail("Run this from the repo root: the reference schema is built from prisma/migrations.");
}
if (url.startsWith("file:") && !existsSync(url.slice("file:".length))) fail(`No database at ${url}.`);

/** Replays the committed migrations into a throwaway file, the way the test harness does. */
function buildReference(dir: string): { db: Database.Database; names: string[] } {
  const migrations = join(process.cwd(), "prisma", "migrations");
  const names = readdirSync(migrations)
    .filter((name) => statSync(join(migrations, name)).isDirectory())
    .sort();
  const db = new Database(join(dir, "reference.db"));
  for (const name of names) db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  return { db, names };
}

async function main(target: string, backupFile: string | undefined): Promise<void> {
  const backup = backupFile ? (JSON.parse(readFileSync(backupFile, "utf8")) as Backup) : null;
  const dir = mkdtempSync(join(tmpdir(), "nexus-verify-m1-"));
  const reference = buildReference(dir);
  const client = createClient({
    url: target,
    authToken: target.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN,
  });
  try {
    console.log(
      backup
        ? `Verifying M1 on ${describeTarget(target)} against ${backupFile} (taken ${backup.takenAt} from ${backup.target})`
        : `Verifying M1 on ${describeTarget(target)} (no --backup: CRM row counts not compared)`,
    );
    const referenceQuery: Query = async (sql) => reference.db.prepare(sql).all() as Row[];
    const checks = await checkM1(queryFrom((sql) => client.execute(sql)), {
      reference: referenceQuery,
      migrationNames: reference.names,
      backupCounts: backup ? rowCounts(backup) : null,
    });
    for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
    const failed = checks.filter((c) => !c.ok).length;
    console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL M1 CHECKS PASSED");
    process.exitCode = failed ? 1 : 0;
  } finally {
    client.close();
    reference.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main(url, backupPath).catch((e) => fail(`ERR ${e instanceof Error ? e.message : String(e)}`));
