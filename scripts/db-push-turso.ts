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
  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const dir of dirs) {
    const sql = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
    console.log(`Applying ${dir}…`);
    await client.executeMultiple(sql);
  }
  console.log(`Done — ${dirs.length} migration(s) applied to ${url}`);
}

main()
  .catch((e) => {
    // Re-running against an existing DB fails on CREATE TABLE — that's expected.
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => client.close());
