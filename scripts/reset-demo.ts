/**
 * Rebuilds the demo workspace: refuses unless this database is the demo, then
 * deletes the demo workspace's CRM rows and re-seeds them.
 *
 * The work lives in src/lib/demo-reset.ts as two units, tested there:
 *   assertResettable    exactly one Workspace, and it is marked isDemo — or it
 *                       throws RESET_REFUSED and this script exits non-zero
 *                       having written nothing;
 *   resetDemoWorkspace  prunes the audit log, deletes that workspace's CRM rows
 *                       (and any an older build left with no workspace),
 *                       re-upserts the demo account's ADMIN membership and
 *                       reseeds. It never writes isDemo.
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
import { assertResettable, resetDemoWorkspace } from "../src/lib/demo-reset";
import { resolveResetTarget } from "../src/lib/reset-guard";
import { assertScriptMode } from "../src/lib/workspace-maintenance";

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
  assertScriptMode("demo:reset");
  console.log(`Resetting the ${target} demo workspace.`);

  // Before any write: a database that is not the demo is refused untouched.
  const { workspaceId } = await assertResettable(prisma);
  console.log(`  workspace: ${workspaceId}`);
  console.log(`  before: ${describe(await counts())}`);

  await resetDemoWorkspace(prisma, workspaceId);

  const after = await counts();
  console.log(`  after:  ${describe(after)}`);

  if (after.users === 0) {
    // Should be impossible — resetDemoWorkspace re-creates the demo account —
    // but a reset that silently emptied the user table would lock everyone out.
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
