/**
 * Maintenance for single-workspace databases, run by scripts (prisma/ and
 * scripts/), never by the app. No "server-only" and no next/* imports: tsx and
 * the Docker esbuild seed bundle load this file.
 *
 * Everything here writes through an unscoped client on purpose: these are the
 * operator's tools for the one-workspace rule, and each refuses a database
 * that breaks it rather than guessing.
 */
import type { PrismaClient } from "../generated/prisma/client";
import { DEMO_EMAIL } from "./demo-guard";
import { ensureSingleWorkspace } from "./workspace-bootstrap";
import { workspaceMode } from "./workspace-mode";

/**
 * The seed, the reset, add-demo-member and the one-off workspace scripts are
 * for single-workspace installs and the public demo. A cloud database must
 * never receive the published demo login or a demo reset, so in multi mode
 * they stop before touching anything. An invalid or missing-in-production
 * WORKSPACE_MODE throws from workspaceMode() itself.
 */
export function assertScriptMode(
  script: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (workspaceMode(env) === "multi") {
    throw new Error(
      `${script} refuses to run when WORKSPACE_MODE=multi. It is for single-workspace installs and the public demo only.`,
    );
  }
}

/**
 * Sets Workspace.isDemo — the nightly reset's permission bit — on the existing
 * demo database, once, by hand (spec §10 step 5). Refuses unless exactly one
 * workspace exists and the published demo account is a member of it, so it
 * cannot mark a self-hoster's workspace, or a cloud database, as resettable.
 */
export async function markDemoWorkspace(
  db: PrismaClient,
): Promise<{ workspaceId: string; changed: boolean }> {
  const workspaces = await db.workspace.findMany({
    select: { id: true, isDemo: true },
    orderBy: { id: "asc" },
    take: 2,
  });
  if (workspaces.length !== 1) {
    throw new Error(
      `MARK_REFUSED: expected exactly one workspace, found ${workspaces.length === 0 ? "none" : "more than one"}.`,
    );
  }
  const workspace = workspaces[0]!;

  const demo = await db.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
  if (!demo) {
    throw new Error(`MARK_REFUSED: ${DEMO_EMAIL} does not exist on this database.`);
  }
  const membership = await db.membership.findUnique({
    where: { userId: demo.id },
    select: { workspaceId: true },
  });
  if (membership?.workspaceId !== workspace.id) {
    throw new Error(`MARK_REFUSED: ${DEMO_EMAIL} is not a member of workspace ${workspace.id}.`);
  }

  if (workspace.isDemo) return { workspaceId: workspace.id, changed: false };
  await db.workspace.update({ where: { id: workspace.id }, data: { isDemo: true } });
  return { workspaceId: workspace.id, changed: true };
}

export type BackfillCounts = {
  memberships: number;
  companies: number;
  contacts: number;
  deals: number;
  activities: number;
  tasks: number;
  auditLogs: number;
};

/**
 * The idempotent catch-up for whatever the old build wrote between M1 and the
 * phase-A deploy (spec §10 step 8):
 *   - a MEMBER membership in the one workspace for every user without one,
 *     written exactly as M1 writes it (id `mem_<userId>`, the user's createdAt);
 *   - CRM rows with no workspace stamped with it;
 *   - audit rows with no workspace stamped with it, except auth.* platform
 *     events, which stay null and are never shown to a workspace.
 *
 * A database with no users and no workspace is left alone: M1 creates the
 * workspace only when a user exists, and so does this.
 */
export async function backfillWorkspace(db: PrismaClient): Promise<BackfillCounts> {
  const [users, workspaces] = await Promise.all([db.user.count(), db.workspace.count()]);
  if (users === 0 && workspaces === 0) {
    return { memberships: 0, companies: 0, contacts: 0, deals: 0, activities: 0, tasks: 0, auditLogs: 0 };
  }

  // Refuses more than one workspace, or any PAID one: this is a single-mode tool.
  const { id: workspaceId } = await ensureSingleWorkspace(db);

  // The same rows M1's catch-up writes: id `mem_<userId>`, MEMBER, and the
  // user's own createdAt, so "member since" and the roster order match M1's.
  const missing = await db.user.findMany({
    where: { membership: { is: null } },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const u of missing) {
    // Created through an upsert keyed on userId, with an empty update: if the
    // live app's single-mode context joins the same user at the same moment,
    // its row stands and this run does not fail on the unique userId.
    await db.membership.upsert({
      where: { userId: u.id },
      update: {},
      create: {
        id: `mem_${u.id}`,
        workspaceId,
        userId: u.id,
        role: "MEMBER",
        createdAt: u.createdAt,
      },
    });
  }

  const unscoped = { workspaceId: null };
  const stamp = { workspaceId };
  const companies = await db.company.updateMany({ where: unscoped, data: stamp });
  const contacts = await db.contact.updateMany({ where: unscoped, data: stamp });
  const deals = await db.deal.updateMany({ where: unscoped, data: stamp });
  const activities = await db.activity.updateMany({ where: unscoped, data: stamp });
  const tasks = await db.task.updateMany({ where: unscoped, data: stamp });
  const auditLogs = await db.auditLog.updateMany({
    where: { workspaceId: null, NOT: { action: { startsWith: "auth." } } },
    data: stamp,
  });

  return {
    memberships: missing.length,
    companies: companies.count,
    contacts: contacts.count,
    deals: deals.count,
    activities: activities.count,
    tasks: tasks.count,
    auditLogs: auditLogs.count,
  };
}
