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
  // `VERCEL` is "1" on preview and development deployments too, so testing it
  // would let every feature-branch preview reach the production database —
  // with DEMO_MODE unset outside Production, so the delete guard is inert there
  // as well. Only a Production deployment gets the database implicitly.
  // Both signals, not either: `vercel env pull --environment=production` writes
  // VERCEL_ENV=production into a local .env, which dotenv then loads — so
  // testing VERCEL_ENV alone would re-open the "local dev wrote to production"
  // incident this guard exists to prevent.
  const isVercelProduction =
    Boolean(process.env.VERCEL) && process.env.VERCEL_ENV === "production";
  // A populated TURSO_DATABASE_URL in a developer's .env would otherwise aim
  // `next dev`, `next start` and the e2e suite straight at production — the
  // same hazard `npm run db:seed` already guards against. Docker is unaffected;
  // it uses a local file volume.
  const remoteAllowed =
    isVercelProduction || process.env.ALLOW_REMOTE_DB === "true";

  if (tursoUrl && remoteAllowed) {
    return new PrismaLibSql({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  // Only on a developer machine: on Vercel the next branch throws instead, and
  // this line would both contradict it and advise pointing a preview at the
  // production database.
  if (tursoUrl && !process.env.VERCEL) {
    console.warn(
      "TURSO_DATABASE_URL is set but ignored — using the local database. Set ALLOW_REMOTE_DB=true to target the remote one.",
    );
  }

  // On a serverless host the filesystem is ephemeral, so falling back to a
  // local file would fail confusingly at query time instead of at boot.
  if (process.env.VERCEL) {
    throw new Error(
      isVercelProduction
        ? "TURSO_DATABASE_URL is required on Vercel — set it in the project's environment variables."
        : `This is a Vercel ${process.env.VERCEL_ENV ?? "non-production"} deployment, so it will not use the production database. To let it run, give it a SEPARATE database and set both TURSO_DATABASE_URL and ALLOW_REMOTE_DB=true scoped to this environment only — Vercel applies variables to every environment unless you scope them, and an unscoped ALLOW_REMOTE_DB puts previews back on production data. Otherwise turn off deployments for this environment.`,
    );
  }
  return new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
}
