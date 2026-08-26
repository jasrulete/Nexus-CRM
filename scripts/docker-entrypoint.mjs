/**
 * Container entrypoint: apply pending Prisma migrations to the SQLite file,
 * optionally seed the demo workspace, then start the Next.js server.
 *
 * Applies the migration SQL with better-sqlite3 directly (it is already in
 * the standalone server's node_modules) because the Prisma CLI is not
 * shipped in the runtime image. Same approach as scripts/db-push-turso.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env.DATABASE_URL ?? "file:/data/nexus.db";
if (!url.startsWith("file:")) {
  console.error(`The Docker image expects a file: DATABASE_URL, got: ${url}`);
  process.exit(1);
}
const dbPath = url.slice("file:".length);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.exec(
  "CREATE TABLE IF NOT EXISTS _docker_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
);
const ledger = db
  .prepare("SELECT name, applied_at FROM _docker_migrations")
  .all();

// A row with no timestamp means a previous boot was killed partway through
// that migration. Replaying it would fail on objects that already exist and
// crash-loop the container on a volume the user is told survives rebuilds, so
// stop with something diagnosable instead. Mirrors scripts/db-push-turso.ts;
// the decision itself is unit-tested in src/lib/migration-ledger.ts.
const interrupted = ledger.find((r) => String(r.applied_at ?? "").trim() === "");
if (interrupted) {
  console.error(
    `Migration "${interrupted.name}" was started but never recorded as finished, ` +
      `so the database may be halfway through it. Refusing to continue. Inspect ` +
      `${dbPath}, finish or undo that migration by hand, then delete its row ` +
      `from _docker_migrations.`,
  );
  process.exit(1);
}

const applied = new Set(ledger.map((r) => r.name));
const migrationsDir = join(appDir, "prisma", "migrations");
const pending = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .filter((name) => !applied.has(name));

for (const name of pending) {
  console.log(`Applying migration ${name}…`);
  // Claimed before it runs, timestamped after — the SQL and the ledger row
  // cannot be made atomic, because Prisma's table-rebuild migrations toggle
  // PRAGMA foreign_keys and SQLite ignores that inside a transaction.
  db.prepare(
    "INSERT INTO _docker_migrations (name, applied_at) VALUES (?, '')",
  ).run(name);
  db.exec(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
  db.prepare(
    "UPDATE _docker_migrations SET applied_at = ? WHERE name = ?",
  ).run(new Date().toISOString(), name);
}
console.log(
  pending.length
    ? `Applied ${pending.length} migration(s) to ${dbPath}.`
    : "Database schema is up to date.",
);
db.close();

if (process.env.SEED_DEMO_DATA === "true") {
  const result = spawnSync(
    process.execPath,
    [join(appDir, "scripts", "seed.cjs")],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await import(join(appDir, "server.js"));
