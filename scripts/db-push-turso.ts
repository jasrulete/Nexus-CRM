/**
 * Applies the Prisma migration SQL to a Turso database.
 * Usage: TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:push:turso
 * (or put both in .env — this script loads it)
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";

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
  const { rows } = await client.execute("SELECT name FROM _turso_migrations");
  const applied = new Set(rows.map((r) => String(r.name)));

  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  const all = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  // Adopting the ledger on a database that predates it: the schema is already
  // there, so record the first migration as applied instead of replaying it.
  if (applied.size === 0) {
    const existing = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='User'",
    );
    if (existing.rows.length > 0 && all.length > 0) {
      console.log(`Baselining existing database at ${all[0]}…`);
      await client.execute({
        sql: "INSERT INTO _turso_migrations (name, applied_at) VALUES (?, ?)",
        args: [all[0], new Date().toISOString()],
      });
      applied.add(all[0]);
    }
  }

  const pending = all.filter((name) => !applied.has(name));

  for (const dir of pending) {
    const sql = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
    console.log(`Applying ${dir}…`);
    await client.executeMultiple(sql);
    await client.execute({
      sql: "INSERT INTO _turso_migrations (name, applied_at) VALUES (?, ?)",
      args: [dir, new Date().toISOString()],
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
