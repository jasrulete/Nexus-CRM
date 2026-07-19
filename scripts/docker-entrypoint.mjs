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
const applied = new Set(
  db.prepare("SELECT name FROM _docker_migrations").all().map((r) => r.name),
);
const migrationsDir = join(appDir, "prisma", "migrations");
const pending = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .filter((name) => !applied.has(name));

for (const name of pending) {
  console.log(`Applying migration ${name}…`);
  db.exec(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
  db.prepare(
    "INSERT INTO _docker_migrations (name, applied_at) VALUES (?, ?)",
  ).run(name, new Date().toISOString());
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
