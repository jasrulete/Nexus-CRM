/**
 * Logical backup of a libSQL / Turso database: sqlite_master plus every
 * table's rows, as JSON under backups/ (gitignored, and kept out of the Docker
 * build context). Read-only against the database. Spec §10, phase A step 3.
 *
 * Ported from research/migration-scripts/backup-turso.cjs, the copy that
 * survived the multi-currency migration. The output folder is now resolved
 * from the repo root instead of a hard-coded machine path, the file name
 * carries a timestamp so a re-run never overwrites an earlier backup, and the
 * credentials are never written into the file.
 *
 * Usage, from the repo root:
 *   npx tsx scripts/backup-turso.ts <label>                         TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (.env)
 *   npx tsx scripts/backup-turso.ts <label> --url file:./path.db    any local libSQL/SQLite file
 */
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { backupArgsError, describeTarget, dumpDatabase, parseCliArgs, queryFrom, rowCounts } from "../src/lib/migration-checks";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Before anything reads the environment or opens a connection: without --url
// this script backs up TURSO_DATABASE_URL, so a mistyped flag or a forgotten
// --url must be refused, not taken for "no --url".
const argError = backupArgsError(process.argv.slice(2));
if (argError) fail(argError);

const { positional, flags } = parseCliArgs(process.argv.slice(2));
const label = positional[0];
const url = flags.url ?? process.env.TURSO_DATABASE_URL;

if (!url) fail("TURSO_DATABASE_URL is not set and no --url was given.");
if (!existsSync(join(process.cwd(), "prisma", "schema.prisma"))) {
  fail("Run this from the repo root: backups/ is resolved from the working directory.");
}
if (url.startsWith("file:") && !existsSync(url.slice("file:".length))) {
  fail(`No database at ${url}: refusing to create an empty one and back that up.`);
}

async function main(target: string): Promise<void> {
  // Say which database this is before connecting to it, so a wrong target is
  // visible even if the connection then hangs or fails.
  console.log(`Backing up ${describeTarget(target)}`);
  const client = createClient({
    url: target,
    authToken: target.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN,
  });
  try {
    const backup = await dumpDatabase(queryFrom((sql) => client.execute(sql)), describeTarget(target));
    const dir = join(process.cwd(), "backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `turso-backup-${label}-${backup.takenAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(backup, null, 1));
    console.log(`Backed up ${backup.target}`);
    console.log(`wrote ${file}`);
    console.log(
      Object.entries(rowCounts(backup))
        .map(([table, n]) => `${table}=${n}`)
        .join(" "),
    );
  } finally {
    client.close();
  }
}

main(url).catch((e) => fail(`ERR ${e instanceof Error ? e.message : String(e)}`));
