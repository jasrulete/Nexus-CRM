import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { forWorkspace, systemDb } from "@/lib/db";
import type { ScopedDb } from "@/lib/tenancy";
import { ensureMember, toMembershipRole, type MembershipRole } from "@/lib/workspace-bootstrap";
import { workspaceMode } from "@/lib/workspace-mode";

/** Where a session that cannot reach a workspace is sent to be cleared. */
export const STALE_SESSION_PATH = "/auth/signout-stale";

export type SafeUser = { id: string; email: string; name: string; createdAt: Date; updatedAt: Date };

export type WorkspaceContext = {
  user: SafeUser;
  workspaceId: string;
  role: MembershipRole;
  /** Workspace.plan: "FREE" | "PAID". */
  plan: string;
  /** The only database handle application code gets: scoped to workspaceId. */
  db: ScopedDb;
};

/**
 * Who is asking, and for which workspace (spec §5.3). Cached per request.
 *
 * Every page loader and server action calls this, directly or through the two
 * require helpers below. Under Next 16 partial rendering a layout neither
 * re-runs on navigation nor stops a page from rendering, so the `(app)` layout
 * is not an auth gate. The workspace always comes from the user's membership,
 * never from client input.
 *
 *  - no session: null.
 *  - session and membership: the context.
 *  - session, no membership, single mode: joined to the one workspace as
 *    MEMBER (the same rule register follows), then the context.
 *  - session, no membership, multi mode: redirected to the route that clears
 *    the session. Cookies can only change in a Route Handler or Server
 *    Function, so this cannot sign out during render itself.
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext | null> => {
  const current = await getCurrentUser();
  if (!current) return null;

  let membership = await systemDb.membership.findUnique({
    where: { userId: current.id },
    select: { workspaceId: true, role: true },
  });
  if (!membership) {
    if (workspaceMode() === "multi") redirect(STALE_SESSION_PATH);
    membership = await ensureMember(systemDb, current.id, "MEMBER");
  }

  const workspace = await systemDb.workspace.findUnique({
    where: { id: membership.workspaceId },
    select: { plan: true },
  });

  return {
    user: {
      id: current.id,
      email: current.email,
      name: current.name,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    },
    workspaceId: membership.workspaceId,
    role: toMembershipRole(membership.role),
    // A missing row reads as the most limited plan.
    plan: workspace?.plan ?? "FREE",
    db: forWorkspace(membership.workspaceId),
  };
});

/** For server actions. */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const ctx = await getWorkspaceContext();
  if (!ctx) throw new Error("UNAUTHORIZED");
  return ctx;
}

/**
 * For pages. The proxy only lets a request with a session cookie reach a page,
 * so "no session" here means the cookie is stale. Sending it to /login would
 * bounce straight back to /dashboard (the proxy redirects a cookie-holder off
 * /login), so it goes through the route that deletes the cookie first and then
 * lands on /login.
 */
export async function requireWorkspacePage(): Promise<WorkspaceContext> {
  const ctx = await getWorkspaceContext();
  if (!ctx) redirect(STALE_SESSION_PATH);
  return ctx;
}

/** The shape canMutate takes. */
export function actorOf(ctx: WorkspaceContext): { id: string; role: MembershipRole } {
  return { id: ctx.user.id, role: ctx.role };
}
