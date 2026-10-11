/**
 * The one workspace of a `single`-mode install, and membership in it (spec §8).
 *
 * Takes the database client as a parameter and has no `server-only` and no
 * `next/*` imports, so the app (through `systemDb` or a transaction's `tx`),
 * the seed, the demo reset and the scripts all share it.
 */
import type { PrismaClient } from "../generated/prisma/client";

export const DEFAULT_WORKSPACE_ID = "ws_default";
export const DEFAULT_WORKSPACE_SLUG = "default";
// Neutral on purpose: self-hosters run the same migration, and their data is real.
export const DEFAULT_WORKSPACE_NAME = "Default workspace";

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER";

const MEMBERSHIP_ROLES: readonly string[] = ["OWNER", "ADMIN", "MEMBER"];

/**
 * Narrows a stored role. `Membership.role` is a free-text column (SQLite has no
 * enums), so anything unexpected is read as the least privileged role.
 */
export function toMembershipRole(value: string): MembershipRole {
  return MEMBERSHIP_ROLES.includes(value) ? (value as MembershipRole) : "MEMBER";
}

/** Satisfied by PrismaClient and by an interactive-transaction `tx`. */
export type BootstrapDb = {
  workspace: Pick<PrismaClient["workspace"], "findMany" | "count" | "create" | "upsert">;
  membership: Pick<PrismaClient["membership"], "findUnique" | "count" | "create" | "update" | "upsert">;
};

/**
 * Throws unless the database is a valid single-mode database: at most one
 * workspace, and none on the PAID plan. Returns that workspace, or null when
 * there is none yet. Read-only, so boot can run it.
 */
export async function assertSingleModeDatabase(
  db: Pick<BootstrapDb, "workspace">,
): Promise<{ id: string } | null> {
  const workspaces = await db.workspace.findMany({
    select: { id: true, plan: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (workspaces.length > 1) {
    throw new Error(
      "SINGLE_MODE_VIOLATION: more than one workspace exists, so this database belongs to a multi-mode deployment",
    );
  }
  if (workspaces[0]?.plan === "PAID") {
    throw new Error(
      "SINGLE_MODE_VIOLATION: the workspace is on the PAID plan, so this database belongs to a multi-mode deployment",
    );
  }
  return workspaces[0] ? { id: workspaces[0].id } : null;
}

/**
 * The one workspace, created with the fixed id if it does not exist yet. The
 * primary key makes a second default impossible, and the upsert keeps two
 * concurrent first calls from failing on it.
 */
export async function ensureSingleWorkspace(db: BootstrapDb): Promise<{ id: string }> {
  const existing = await assertSingleModeDatabase(db);
  if (existing) return existing;
  const created = await db.workspace.upsert({
    where: { id: DEFAULT_WORKSPACE_ID },
    create: {
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      slug: DEFAULT_WORKSPACE_SLUG,
    },
    update: {},
    select: { id: true },
  });
  return { id: created.id };
}

export async function memberCount(db: BootstrapDb, workspaceId: string): Promise<number> {
  return db.membership.count({ where: { workspaceId } });
}

/**
 * Single mode only: joins the user to the one workspace. An existing
 * membership keeps its role unless `opts.setRole` asks for `role`.
 *
 * An upsert on the unique `userId`, so two concurrent first requests for the
 * same user cannot create two memberships or fail on the second insert.
 */
export async function ensureMember(
  db: BootstrapDb,
  userId: string,
  role: MembershipRole,
  opts: { setRole?: boolean } = {},
): Promise<{ workspaceId: string; role: MembershipRole }> {
  const { id: workspaceId } = await ensureSingleWorkspace(db);
  const membership = await db.membership.upsert({
    where: { userId },
    create: { workspaceId, userId, role },
    update: opts.setRole ? { role } : {},
    select: { workspaceId: true, role: true },
  });
  return { workspaceId: membership.workspaceId, role: toMembershipRole(membership.role) };
}
