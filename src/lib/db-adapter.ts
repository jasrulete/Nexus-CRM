import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";

/**
 * Picks the database driver from the environment:
 *  - TURSO_DATABASE_URL set  → Turso/libSQL (serverless deploys, e.g. Vercel)
 *  - otherwise               → local SQLite file (zero-setup dev)
 *
 * Both are SQLite dialects, so one Prisma schema serves both.
 */
export function createDbAdapter() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    return new PrismaLibSql({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  // On a serverless host the filesystem is ephemeral, so falling back to a
  // local file would fail confusingly at query time instead of at boot.
  if (process.env.VERCEL) {
    throw new Error(
      "TURSO_DATABASE_URL is required on Vercel — set it in the project's environment variables.",
    );
  }
  return new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
}
