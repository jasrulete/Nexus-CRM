import "server-only";
import { isWorkspaceAdmin } from "@/lib/authz";
import { isLockedDemoAccount } from "@/lib/demo-guard";
import type { WorkspaceContext } from "@/lib/workspace-context";

export type RosterEntry = {
  id: string;
  name: string;
  role: string;
  isAdmin: boolean;
  email: string | null;
};

/**
 * The Settings page's team roster and audit card (spec §5.6).
 *
 * Both read through ctx.db. The roster is this workspace's memberships with
 * each member's display fields, and the nested `user` read hangs off a scoped
 * parent, so it can only reach this workspace's members. The audit card reads
 * this workspace's rows only. The platform rows (auth.*, workspaceId null),
 * including failed-login rows that carry a caller's IP, are never selected,
 * so they can never be rendered.
 */
export async function loadSettings(ctx: WorkspaceContext) {
  const isAdmin = isWorkspaceAdmin(ctx.role);

  const [members, auditEntries] = await Promise.all([
    ctx.db.membership.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { createdAt: "asc" } },
    }),
    isAdmin
      ? ctx.db.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 25,
          include: { user: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  // Registration is open, so without this a MEMBER could register a throwaway
  // account and read every address in the workspace. Names and roles stay
  // visible as team context; an address is PII and doesn't. The shared demo
  // account is an ADMIN with a published password, so it sees no addresses
  // either. A viewer's own address is theirs to see.
  const showEmails = isAdmin && !isLockedDemoAccount(ctx.user);
  const roster: RosterEntry[] = members.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    role: m.role,
    isAdmin: isWorkspaceAdmin(m.role),
    email: showEmails || m.user.id === ctx.user.id ? m.user.email : null,
  }));

  return { isAdmin, roster, auditEntries };
}
