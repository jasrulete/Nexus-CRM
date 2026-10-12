/**
 * Demo data seed. Run with: npm run db:seed
 * Creates a demo login: demo@nexuscrm.dev / demo-password-123
 *
 * The dataset itself lives in seed-data.ts so the nightly reset can rebuild it
 * without recreating accounts. See scripts/reset-demo.ts.
 *
 * Single-workspace installs only: it refuses to run when WORKSPACE_MODE=multi,
 * because a cloud database must never receive the published demo login. The
 * seeded workspace is marked as the demo — the nightly reset's permission bit —
 * only when SEED_DEMO_WORKSPACE=true. Docker's SEED_DEMO_DATA boot and CI never
 * set it, so a self-hoster's workspace can never become resettable by being
 * seeded (scripts/mark-demo-workspace.ts can still mark one; see its header).
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";
import { assertScriptMode } from "../src/lib/workspace-maintenance";
import { seedInstall } from "./seed-data";

// createDbAdapter() prefers TURSO_DATABASE_URL, and .env is loaded above — so
// a plain `npm run db:seed` on a dev machine would write demo data (including a
// publicly-documented ADMIN login) straight into production. Seeding a remote
// database has to be asked for explicitly.
if (process.env.SEED_REMOTE === "true") {
  console.log("SEED_REMOTE=true — seeding the remote database.");
  // createDbAdapter() ignores Turso outside Vercel unless told otherwise.
  process.env.ALLOW_REMOTE_DB = "true";
} else if (process.env.TURSO_DATABASE_URL) {
  console.log(
    "Seeding the local database (TURSO_DATABASE_URL ignored — use SEED_REMOTE=true to target the remote one).",
  );
  delete process.env.TURSO_DATABASE_URL;
}

const prisma = new PrismaClient({ adapter: createDbAdapter() });

async function main() {
  assertScriptMode("db:seed");

  const result = await seedInstall(prisma, {
    markDemo: process.env.SEED_DEMO_WORKSPACE === "true",
  });
  if (result.skipped) {
    console.log("Seed data already present — skipping. (Delete dev.db to reseed.)");
    return;
  }

  console.log("Seeded demo workspace:");
  console.log(
    `  ${result.counts.companies} companies, ${result.counts.contacts} contacts, ${result.counts.deals} deals`,
  );
  if (result.markedDemo) {
    console.log("  Marked as the demo workspace (SEED_DEMO_WORKSPACE=true): the nightly reset may rebuild it.");
  }
  console.log("  Login: demo@nexuscrm.dev / demo-password-123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
