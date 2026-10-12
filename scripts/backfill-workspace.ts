/**
 * The idempotent catch-up for whatever the old build wrote between M1 and the
 * phase-A deploy: a MEMBER membership for every user without one, and the one
 * workspace stamped on every CRM row and non-auth.* audit row that has none.
 * Phase A's runbook runs it after the phase-A deploy is live, with the user's
 * explicit go (docs/runbooks/2026-10-tenancy-phase-a.md, step 8). Safe to run
 * again: a second run reports zeros.
 *
 * Refuses to run when WORKSPACE_MODE=multi, and refuses a database with more
 * than one workspace.
 *
 * Local:  npx tsx scripts/backfill-workspace.ts
 * Remote: ALLOW_REMOTE_DB=true npx tsx scripts/backfill-workspace.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";
import { resolveResetTarget } from "../src/lib/reset-guard";
import { assertScriptMode, backfillWorkspace } from "../src/lib/workspace-maintenance";

const target = resolveResetTarget();
const prisma = new PrismaClient({ adapter: createDbAdapter() });

async function main() {
  assertScriptMode("backfill-workspace");
  console.log(`Backfilling workspace ids on the ${target} database.`);
  const c = await backfillWorkspace(prisma);
  console.log(
    `  memberships added: ${c.memberships}; rows stamped: ${c.companies} companies, ${c.contacts} contacts, ${c.deals} deals, ${c.activities} activities, ${c.tasks} tasks, ${c.auditLogs} audit entries`,
  );
  console.log("Backfill complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
