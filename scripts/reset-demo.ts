/**
 * Rebuilds the demo workspace: deletes every CRM row, then re-seeds.
 *
 * User accounts are deliberately untouched. Production holds real logins
 * alongside the demo account, and a nightly job must not delete them.
 *
 * Local:  npm run demo:reset
 * Remote: ALLOW_REMOTE_DB=true npm run demo:reset   (what CI does nightly)
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";
import { auditPruneWhere, resolveResetTarget } from "../src/lib/reset-guard";
import { DEMO_EMAIL } from "../src/lib/demo-guard";
import { ensureDemoUser, seedDemoData } from "../prisma/seed-data";

// "local" here means createDbAdapter() will ignore Turso, because both read the
// same ALLOW_REMOTE_DB flag — the target reported below is the one actually used.
const target = resolveResetTarget();

const prisma = new PrismaClient({ adapter: createDbAdapter() });

async function counts() {
  const [companies, contacts, deals, tasks, activities, users, auditLogs] =
    await Promise.all([
      prisma.company.count(),
      prisma.contact.count(),
      prisma.deal.count(),
      prisma.task.count(),
      prisma.activity.count(),
      prisma.user.count(),
      prisma.auditLog.count(),
    ]);
  return { companies, contacts, deals, tasks, activities, users, auditLogs };
}

function describe(c: Awaited<ReturnType<typeof counts>>) {
  return `${c.companies} companies, ${c.contacts} contacts, ${c.deals} deals, ${c.tasks} tasks, ${c.activities} activities, ${c.users} users, ${c.auditLogs} audit entries`;
}

async function main() {
  console.log(`Resetting the ${target} demo workspace.`);
  console.log(`  before: ${describe(await counts())}`);

  // AuditLog is pruned, not emptied — see auditPruneWhere. It holds no
  // foreign key into the CRM tables (entityId is a plain string), so it is
  // not part of the ordering below and a real account's security trail has
  // no reason to die with the demo data.
  const demoUser = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: auditPruneWhere({ demoUserId: demoUser?.id ?? null, now: new Date() }),
  });

  // Ordered so foreign keys are satisfied without relying on cascade
  // behaviour. User, Session and the migration ledger are never touched.
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();

  const demo = await ensureDemoUser(prisma);
  await seedDemoData(prisma, demo.id);

  const after = await counts();
  console.log(`  after:  ${describe(after)}`);

  if (after.users === 0) {
    // Should be impossible — ensureDemoUser runs above — but a reset that
    // silently emptied the user table would lock everyone out.
    throw new Error("Reset left no user accounts; refusing to report success.");
  }
  console.log("Demo workspace reset.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
