/**
 * Applies the Prisma migration SQL to a Turso database.
 * Usage: TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:push:turso
 * (or put both in .env — this script loads it)
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { planMigrations } from "../src/lib/migration-ledger";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("TURSO_DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  // Ledger of applied migrations, mirroring the Docker entrypoint. Without it
  // a re-run replays migration #1, fails on CREATE TABLE, and never reaches
  // the newer migrations.
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _turso_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const { rows } = await client.execute(
    "SELECT name, applied_at FROM _turso_migrations",
  );

  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  const all = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const existing = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='User'",
  );

  const plan = planMigrations({
    ledger: rows.map((r) => ({
      name: String(r.name),
      applied_at: String(r.applied_at ?? ""),
    })),
    all,
    hasExistingSchema: existing.rows.length > 0,
  });

  if (plan.kind === "interrupted") {
    throw new Error(plan.message);
  }

  if (plan.kind === "baseline") {
    console.log(`Baselining existing database at ${plan.migration}…`);
    await client.execute({
      sql: "INSERT INTO _turso_migrations (name, applied_at) VALUES (?, ?)",
      args: [plan.migration, new Date().toISOString()],
    });
  }

  const pending = plan.pending;

  for (const dir of pending) {
    const sql = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
    console.log(`Applying ${dir}…`);

    // Claim the migration *before* running it, with no timestamp. The SQL and
    // the ledger row cannot be made atomic — Prisma's table-rebuild migrations
    // toggle PRAGMA foreign_keys, which SQLite ignores inside a transaction —
    // so instead an interruption leaves a row that says "started, never
    // finished", and the next run refuses to guess rather than silently
    // baselining a half-built schema.
    await client.execute({
      sql: "INSERT INTO _turso_migrations (name, applied_at) VALUES (?, '')",
      args: [dir],
    });
    await client.executeMultiple(sql);
    await client.execute({
      sql: "UPDATE _turso_migrations SET applied_at = ? WHERE name = ?",
      args: [new Date().toISOString(), dir],
    });
  }

  console.log(
    pending.length
      ? `Applied ${pending.length} migration(s) to ${url}`
      : "Turso schema is up to date.",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => client.close());
