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

/** Thrown by assertSingleModeDatabase; the boot check tells it from a transient failure. */
class SingleModeViolationError extends Error {}

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
    throw new SingleModeViolationError(
      "SINGLE_MODE_VIOLATION: more than one workspace exists, so this database belongs to a multi-mode deployment",
    );
  }
  if (workspaces[0]?.plan === "PAID") {
    throw new SingleModeViolationError(
      "SINGLE_MODE_VIOLATION: the workspace is on the PAID plan, so this database belongs to a multi-mode deployment",
    );
  }
  return workspaces[0] ? { id: workspaces[0].id } : null;
}

/**
 * assertSingleModeDatabase as boot runs it (instrumentation's register()).
 *
 * Next caches register()'s promise for the life of the process, so a rejection
 * here fails every request on that instance, including ones that never touch
 * the database. Only two outcomes are worth that:
 *  - a SINGLE_MODE_VIOLATION: this database belongs to a multi-mode deployment;
 *  - a missing table (Prisma P2021): the migrations were not applied.
 * Any other failure (a Turso timeout, a busy database) is logged and boot
 * continues. That is safe because ensureSingleWorkspace and ensureMember run
 * assertSingleModeDatabase again before every write.
 */
export async function bootCheckSingleModeDatabase(
  db: Pick<BootstrapDb, "workspace">,
): Promise<void> {
  try {
    await assertSingleModeDatabase(db);
  } catch (error) {
    if (error instanceof SingleModeViolationError) throw error;
    if ((error as { code?: unknown } | null)?.code === "P2021") {
      throw new Error(
        "The database is missing a table (Prisma P2021): apply the database migrations (M1) before starting",
        { cause: error },
      );
    }
    console.error(
      "single-mode boot check could not read the database; continuing, because every workspace write re-checks it:",
      error,
    );
  }
}

/**
 * The one workspace, created with the fixed id if it does not exist yet. The
 * primary key makes a second default impossible. `update: { id }` is a
 * deliberate no-op (the id rewritten to itself): any field in `update` makes
 * Prisma emit a single `INSERT ... ON CONFLICT DO UPDATE`, which two
 * concurrent first calls, even on different instances, cannot fail on, whereas
 * `update: {}` falls back to SELECT, INSERT, SELECT, which they can.
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
    update: { id: DEFAULT_WORKSPACE_ID },
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
 * An upsert on the unique `userId` that compiles to a single
 * `INSERT ... ON CONFLICT DO UPDATE`, so two concurrent first requests for the
 * same user, even on different instances, cannot create two memberships or
 * fail on the second insert. `update: { userId }` is a deliberate no-op: it
 * rewrites the column to its own value, which keeps an existing role while
 * still giving Prisma an update to compile (`update: {}` would not, and falls
 * back to SELECT, INSERT, SELECT).
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
    update: opts.setRole ? { role } : { userId },
    select: { workspaceId: true, role: true },
  });
  return { workspaceId: membership.workspaceId, role: toMembershipRole(membership.role) };
}
