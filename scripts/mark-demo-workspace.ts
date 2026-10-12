/**
 * One-off and human-run: marks the existing demo database's only workspace as
 * the demo (Workspace.isDemo = true), the permission bit the nightly reset
 * checks. Phase A's runbook runs it once, after M1's verify gate, with the
 * user's explicit go (docs/runbooks/2026-10-tenancy-phase-a.md, step 5).
 *
 * Refuses unless exactly one workspace exists and demo@nexuscrm.dev is a member
 * of it. That guard relies on the demo account not being seeded on real
 * installs: a self-hosted install seeded with the demo data (the default
 * docker-compose sets SEED_DEMO_DATA=true) has exactly that shape, so run this
 * only against the demo database. Refuses to run when WORKSPACE_MODE=multi.
 *
 * Local:  npx tsx scripts/mark-demo-workspace.ts
 * Remote: ALLOW_REMOTE_DB=true npx tsx scripts/mark-demo-workspace.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";
import { resolveResetTarget } from "../src/lib/reset-guard";
import { assertScriptMode, markDemoWorkspace } from "../src/lib/workspace-maintenance";

const target = resolveResetTarget();
const prisma = new PrismaClient({ adapter: createDbAdapter() });

async function main() {
  assertScriptMode("mark-demo-workspace");
  console.log(`Marking the demo workspace on the ${target} database.`);
  const { workspaceId, changed } = await markDemoWorkspace(prisma);
  console.log(
    changed
      ? `Workspace ${workspaceId} is now marked isDemo.`
      : `Workspace ${workspaceId} was already marked isDemo; nothing changed.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
