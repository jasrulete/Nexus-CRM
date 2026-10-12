/**
 * Adds (or resets) a non-admin demo account so reviewers can see the
 * member-level view alongside the admin "Try the demo" login:
 *
 *   member@nexuscrm.dev / member-password-123   (membership role: MEMBER)
 *
 * Idempotent — upserts only this one account and its membership in the one
 * workspace, touching nothing else. Refuses to run when WORKSPACE_MODE=multi.
 * Run with:
 *   npm run db:add-member          (local dev.db, or Turso with ALLOW_REMOTE_DB=true)
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";
import { assertScriptMode } from "../src/lib/workspace-maintenance";
import { DEMO_MEMBER_EMAIL, ensureDemoMember } from "./seed-data";

const prisma = new PrismaClient({ adapter: createDbAdapter() });

async function main() {
  assertScriptMode("db:add-member");
  await ensureDemoMember(prisma);
  console.log(`Demo member ready: ${DEMO_MEMBER_EMAIL} / member-password-123`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
