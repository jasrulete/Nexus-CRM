/**
 * Demo data seed. Run with: npm run db:seed
 * Creates a demo login: demo@nexuscrm.dev / demo-password-123
 *
 * The dataset itself lives in seed-data.ts so the nightly reset can rebuild it
 * without recreating accounts. See scripts/reset-demo.ts.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";
import { ensureDemoUser, seedDemoData } from "./seed-data";

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
  const existing = await prisma.user.findUnique({
    where: { email: "demo@nexuscrm.dev" },
  });
  if (existing) {
    console.log("Seed data already present — skipping. (Delete dev.db to reseed.)");
    return;
  }

  const demo = await ensureDemoUser(prisma);
  const counts = await seedDemoData(prisma, demo.id);

  console.log("Seeded demo workspace:");
  console.log(`  ${counts.companies} companies, ${counts.contacts} contacts, ${counts.deals} deals`);
  console.log("  Login: demo@nexuscrm.dev / demo-password-123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
