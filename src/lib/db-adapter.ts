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
  // A populated TURSO_DATABASE_URL in a developer's .env would otherwise aim
  // `next dev`, `next start` and the e2e suite straight at production — the
  // same hazard `npm run db:seed` already guards against. Vercel is the only
  // deployment that reaches Turso implicitly; Docker uses a local file volume.
  const remoteAllowed =
    Boolean(process.env.VERCEL) || process.env.ALLOW_REMOTE_DB === "true";

  if (tursoUrl && remoteAllowed) {
    return new PrismaLibSql({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  if (tursoUrl) {
    console.warn(
      "TURSO_DATABASE_URL is set but ignored — using the local database. Set ALLOW_REMOTE_DB=true to target the remote one.",
    );
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
