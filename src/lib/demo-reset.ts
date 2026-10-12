/**
 * The nightly demo reset, as two units so each can be tested on its own
 * (spec §8). scripts/reset-demo.ts calls them in order.
 *
 * No "server-only" and no next/* imports: the reset runs under tsx in a
 * GitHub Actions job, outside any Next bundle.
 *
 * Workspace.isDemo is the reset's permission bit and nothing else, and nothing
 * in this file writes it. The seed sets it only with SEED_DEMO_WORKSPACE=true,
 * and scripts/mark-demo-workspace.ts sets it once, by hand, on the existing
 * demo database. Seeding a self-hosted install does not mark it, so the reset
 * refuses such a database, and any other unmarked one a mis-set secret points
 * this workflow at. What keeps a real install from being marked is outside this
 * file: mark-demo-workspace.ts's guard relies on the demo account not being
 * seeded on real installs, and on the script being run only against the demo
 * database. A self-host seeded with the demo data has the shape it accepts.
 */
import type { PrismaClient } from "../generated/prisma/client";
import { ensureDemoUser, seedDemoData } from "../../prisma/seed-data";
import { DEMO_EMAIL } from "./demo-guard";
import { auditPruneWhere } from "./reset-guard";

/**
 * Throws RESET_REFUSED unless the database holds exactly one workspace and
 * that workspace is marked as the demo. Runs before the reset writes anything.
 */
export async function assertResettable(db: PrismaClient): Promise<{ workspaceId: string }> {
  const workspaces = await db.workspace.findMany({
    select: { id: true, isDemo: true },
    orderBy: { id: "asc" },
    take: 2,
  });
  if (workspaces.length === 0) {
    throw new Error("RESET_REFUSED: this database has no workspace, so there is no demo to reset.");
  }
  if (workspaces.length > 1) {
    throw new Error(
      "RESET_REFUSED: this database has more than one workspace. The demo reset only runs against the single-workspace demo database.",
    );
  }
  const only = workspaces[0]!;
  if (!only.isDemo) {
    throw new Error(
      `RESET_REFUSED: workspace ${only.id} is not marked as the demo (isDemo is false). If this really is the demo database, run scripts/mark-demo-workspace.ts once; never on a real install.`,
    );
  }
  return { workspaceId: only.id };
}

/**
 * Rebuilds one workspace's demo data:
 *   - prunes the audit log by today's rule (auditPruneWhere): the demo
 *     account's rows, plus any row — workspace or platform — older than 30 days;
 *   - deletes the workspace's CRM rows, and rows with no workspace at all, in
 *     foreign-key-safe order;
 *   - re-creates the demo account if it is missing, re-upserts its ADMIN
 *     membership, and reseeds.
 * It never creates a workspace and never writes isDemo. User, Session,
 * Workspace and the migration ledgers are never touched.
 */
export async function resetDemoWorkspace(
  db: PrismaClient,
  workspaceId: string,
  opts: { now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();

  // Checked before anything is deleted: reseeding this workspace for a demo
  // account that belongs to another would split the demo across two.
  const existingDemo = await db.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });
  if (existingDemo) {
    const membership = await db.membership.findUnique({
      where: { userId: existingDemo.id },
      select: { workspaceId: true },
    });
    if (membership && membership.workspaceId !== workspaceId) {
      throw new Error(
        `RESET_REFUSED: ${DEMO_EMAIL} belongs to workspace ${membership.workspaceId}, not ${workspaceId}.`,
      );
    }
  }

  // AuditLog is pruned, not emptied (PRD L10). It holds no foreign key into
  // the CRM tables (entityId is a plain string), so it is not part of the
  // ordering below, and a real account's security trail has no reason to die
  // with the demo data.
  await db.auditLog.deleteMany({
    where: auditPruneWhere({ demoUserId: existingDemo?.id ?? null, now }),
  });

  // Rows with no workspace can only be demo rows an older build wrote:
  // assertResettable has already established that this database holds one
  // workspace. Ordered so foreign keys are satisfied without relying on
  // cascade behaviour.
  const scope = { OR: [{ workspaceId }, { workspaceId: null }] };
  await db.activity.deleteMany({ where: scope });
  await db.task.deleteMany({ where: scope });
  await db.deal.deleteMany({ where: scope });
  await db.contact.deleteMany({ where: scope });
  await db.company.deleteMany({ where: scope });

  const demo = await ensureDemoUser(db);
  await db.membership.upsert({
    where: { userId: demo.id },
    update: { role: "ADMIN" },
    create: { workspaceId, userId: demo.id, role: "ADMIN" },
  });
  await seedDemoData(db, demo.id, workspaceId);
}
