/**
 * Harness for testing the server-action layer against a real database.
 *
 * The actions are where every authorization decision lives, and until now none
 * of them had a direct test — a regression that reintroduced the missing
 * ownership check on updates would have passed CI green while the Settings page
 * told users "every mutation is authorized on the server".
 *
 * The point of this harness is that only four things are faked:
 *   - `@/lib/db`           -> `systemDb` is a throwaway SQLite file built from
 *                             the real migrations, and `forWorkspace` applies the
 *                             real `scopeToWorkspace` extension to it
 *   - `@/lib/auth/session` -> only the session-cookie lookup: a settable current
 *                             user, so a test can BE someone. `getWorkspaceContext`
 *                             then resolves that user's membership for real
 *   - `next/cache`         -> revalidatePath is a no-op outside a request
 *   - `next/navigation`    -> redirect throws, the way Next's own does
 *
 * Every action test mocks the first two the same way:
 *
 *   vi.mock("@/lib/db", async () => {
 *     const { scopeToWorkspace } = await import("@/lib/tenancy");
 *     return { systemDb: prisma, prisma, scopeToWorkspace,
 *              forWorkspace: (ws: string) => scopeToWorkspace(prisma, ws) };
 *   });
 *   vi.mock("@/lib/auth/session", () => ({
 *     getCurrentUser: async () => currentUser, requireUser: async () => currentUser,
 *     createSession: async () => {}, destroySession: async () => {},
 *   }));
 *
 * Everything else — zod, canMutate, audit, the demo guard, findMissingRelation,
 * the tenancy extension, membership resolution — runs for real. A test that
 * passes here exercises the actual chain.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_SLUG,
  type MembershipRole,
} from "@/lib/workspace-bootstrap";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/** A user as the app sees one: identity plus their one membership. */
export type TestUser = {
  id: string;
  email: string;
  name: string;
  role: MembershipRole;
  workspaceId: string;
};

/**
 * Builds a fresh database by replaying the committed migrations, so the schema
 * under test is the schema that ships — not one `db push` inferred from the
 * Prisma schema file.
 *
 * `through` stops after the named migration directory (inclusive). A test can
 * then insert fixtures at that older schema with raw SQL against `file`, and
 * call `applyRemaining()` to run the later migrations exactly as every runner
 * runs them (spec §9.8). The generated client only knows the current schema,
 * so use `prisma` once every migration has been applied.
 */
export function createTestDatabase(opts: { through?: string } = {}): {
  prisma: PrismaClient;
  file: string;
  applyRemaining(): void;
  destroy(): Promise<void>;
} {
  const dir = mkdtempSync(join(tmpdir(), "nexus-actions-"));
  const file = join(dir, "test.db");

  const names = readdirSync(MIGRATIONS_DIR)
    .filter((n) => statSync(join(MIGRATIONS_DIR, n)).isDirectory())
    .sort();
  let cut = names.length;
  if (opts.through !== undefined) {
    const at = names.indexOf(opts.through);
    if (at === -1) {
      throw new Error(`createTestDatabase: no migration directory named "${opts.through}"`);
    }
    cut = at + 1;
  }
  let pending = names.slice(cut);
  applyMigrations(file, names.slice(0, cut));

  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${file}` }),
  });

  return {
    prisma,
    file,
    applyRemaining() {
      const batch = pending;
      pending = [];
      applyMigrations(file, batch);
    },
    async destroy() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function applyMigrations(file: string, names: string[]) {
  const raw = new Database(file);
  try {
    // Prisma's own migrations do not switch this on, and libSQL/Turso defaults it
    // off — but better-sqlite3 defaults it off too, so enable it explicitly here
    // rather than let onDelete rules silently not apply during a test.
    raw.pragma("foreign_keys = ON");
    for (const name of names) {
      raw.exec(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
    }
  } finally {
    // Closing also rolls back a transaction a failed migration left open.
    raw.close();
  }
}

/** Deletes every row without dropping the schema, between tests. */
export async function truncateAll(prisma: PrismaClient) {
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.aiUsage.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
}

let workspaceSeq = 0;

export async function makeWorkspace(
  prisma: PrismaClient,
  overrides: { id?: string; name?: string; slug?: string; plan?: string; isDemo?: boolean } = {},
): Promise<{ id: string }> {
  workspaceSeq += 1;
  return prisma.workspace.create({
    data: {
      id: overrides.id,
      name: overrides.name ?? `Workspace ${workspaceSeq}`,
      slug: overrides.slug ?? `workspace-${workspaceSeq}`,
      plan: overrides.plan ?? "FREE",
      isDemo: overrides.isDemo ?? false,
    },
    select: { id: true },
  });
}

/** The single-mode default workspace, created the first time a test needs it. */
async function defaultWorkspaceId(prisma: PrismaClient): Promise<string> {
  const workspace = await prisma.workspace.upsert({
    where: { id: DEFAULT_WORKSPACE_ID },
    create: { id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME, slug: DEFAULT_WORKSPACE_SLUG },
    update: {},
    select: { id: true },
  });
  return workspace.id;
}

/**
 * Creates a user and their membership. Without a `workspaceId` the user joins
 * the default workspace, which is what a single-mode install looks like.
 * `User.role` is deprecated and left at its column default: the membership's
 * role is the one the app reads.
 */
export async function makeUser(
  prisma: PrismaClient,
  overrides: { email: string; name?: string; role?: MembershipRole; workspaceId?: string },
): Promise<TestUser> {
  const workspaceId = overrides.workspaceId ?? (await defaultWorkspaceId(prisma));
  const role = overrides.role ?? "MEMBER";
  const user = await prisma.user.create({
    data: {
      email: overrides.email,
      name: overrides.name ?? overrides.email.split("@")[0],
      // Never verified in these tests; the auth actions have their own suite.
      passwordHash: "not-a-real-hash",
    },
  });
  await prisma.membership.create({ data: { workspaceId, userId: user.id, role } });
  return { id: user.id, email: user.email, name: user.name, role, workspaceId };
}

/** Builds a FormData the way a real `<form>` submission would. */
export function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

/**
 * Same, plus the optimistic-concurrency version the edit forms carry.
 *
 * The update actions refuse a submit with no version rather than falling back
 * to last-write-wins, so a test exercising the *allowed* path has to send one —
 * exactly as the real form does.
 */
export function formDataFor(
  record: { updatedAt: Date },
  fields: Record<string, string>,
): FormData {
  return formData({ ...fields, updatedAt: record.updatedAt.toISOString() });
}
