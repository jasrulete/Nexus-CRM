/**
 * Workspace resolution against a real database. Only the session-cookie lookup
 * and Next's redirect are faked; the membership lookup, the single-mode join and
 * the scoped client run for real.
 *
 * Review Focus 1: a signed-in user whose membership is missing is joined as
 * MEMBER in single mode, and in multi mode is sent to the route that clears the
 * session, never into a /login <-> /dashboard loop.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeUser, makeWorkspace, truncateAll } from "@/test/action-harness";
import { twoWorkspaces, type TenantFixture } from "@/test/cross-tenant";
import { DEFAULT_WORKSPACE_ID } from "./workspace-bootstrap";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
    scopeToWorkspace,
    forWorkspace: (ws: string) => scopeToWorkspace(prisma, ws),
  };
});

type SessionUser = { id: string; email: string; name: string; createdAt: Date; updatedAt: Date };
let currentUser: SessionUser | null = null;
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => currentUser,
  requireUser: async () => currentUser,
  createSession: async () => {},
  destroySession: async () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

const { actorOf, getWorkspaceContext, requireWorkspace, requireWorkspacePage } = await import(
  "./workspace-context"
);

afterAll(async () => {
  await destroy();
});

beforeEach(async () => {
  await truncateAll(prisma);
  currentUser = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A signed-in user with no membership: the old-build window, or a removed member. */
async function userWithoutMembership(email = "orphan@example.com"): Promise<SessionUser> {
  return prisma.user.create({
    data: { email, name: "Orphan", passwordHash: "not-a-real-hash" },
    select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
  });
}

describe("no session", () => {
  it("has no context, and actions are unauthorized", async () => {
    expect(await getWorkspaceContext()).toBeNull();
    await expect(requireWorkspace()).rejects.toThrow("UNAUTHORIZED");
  });

  it("sends a page through the route that clears the stale cookie, not straight to /login", async () => {
    // The proxy bounces a cookie-holder off /login to /dashboard, so a page
    // redirecting a stale cookie to /login looped forever.
    await expect(requireWorkspacePage()).rejects.toThrow("NEXT_REDIRECT:/auth/signout-stale");
  });
});

describe("a member", () => {
  let a: TenantFixture;
  let b: TenantFixture;

  beforeEach(async () => {
    ({ a, b } = await twoWorkspaces(prisma));
    currentUser = await prisma.user.findUniqueOrThrow({
      where: { id: a.owner.id },
      select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
    });
  });

  it("gets their workspace, role and plan from the membership", async () => {
    const ctx = await requireWorkspace();

    expect(ctx).toMatchObject({ workspaceId: a.workspaceId, role: "OWNER", plan: "FREE" });
    expect(ctx.user).toEqual(currentUser);
    expect(actorOf(ctx)).toEqual({ id: a.owner.id, role: "OWNER" });
  });

  it("gets a database handle that sees only their workspace", async () => {
    const ctx = await requireWorkspacePage();

    expect(await ctx.db.contact.count()).toBe(1);
    expect(await ctx.db.contact.findUnique({ where: { id: b.contactId } })).toBeNull();
  });

  it("reads the plan from the workspace row", async () => {
    await prisma.workspace.update({ where: { id: a.workspaceId }, data: { plan: "PAID" } });

    expect((await requireWorkspace()).plan).toBe("PAID");
  });

  it("works the same in multi mode", async () => {
    vi.stubEnv("WORKSPACE_MODE", "multi");

    expect((await requireWorkspace()).workspaceId).toBe(a.workspaceId);
  });
});

describe("a signed-in user with no membership, multi mode", () => {
  beforeEach(() => {
    vi.stubEnv("WORKSPACE_MODE", "multi");
  });

  it.each([
    ["getWorkspaceContext", () => getWorkspaceContext()],
    ["requireWorkspace", () => requireWorkspace()],
    ["requireWorkspacePage", () => requireWorkspacePage()],
  ])("%s redirects to the route that signs them out", async (_name, call) => {
    await makeWorkspace(prisma, { id: "ws_someone_else" });
    currentUser = await userWithoutMembership();

    await expect(call()).rejects.toThrow("NEXT_REDIRECT:/auth/signout-stale");
    // Never joined to anyone's workspace, and no workspace made for them.
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.workspace.count()).toBe(1);
  });
});

describe("a signed-in user with no membership, single mode", () => {
  beforeEach(() => {
    vi.stubEnv("WORKSPACE_MODE", "single");
  });

  it("joins the one workspace as MEMBER", async () => {
    await makeUser(prisma, { email: "first@example.com", role: "OWNER" });
    currentUser = await userWithoutMembership();

    const ctx = await requireWorkspacePage();

    expect(ctx).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, role: "MEMBER" });
    expect(await prisma.workspace.count()).toBe(1);
    expect(await prisma.membership.findUnique({ where: { userId: currentUser.id } })).toMatchObject({
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "MEMBER",
    });
  });

  it("creates the default workspace when there is none yet", async () => {
    currentUser = await userWithoutMembership();

    expect(await requireWorkspace()).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, role: "MEMBER" });
  });

  it("joins only once across repeated requests", async () => {
    currentUser = await userWithoutMembership();

    await requireWorkspace();
    await requireWorkspace();

    expect(await prisma.membership.count()).toBe(1);
  });

  it("refuses a database with two workspaces", async () => {
    await makeWorkspace(prisma, { id: "ws_1" });
    await makeWorkspace(prisma, { id: "ws_2" });
    currentUser = await userWithoutMembership();

    await expect(requireWorkspace()).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
    expect(await prisma.membership.count()).toBe(0);
  });
});
