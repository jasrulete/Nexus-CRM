/**
 * Page loaders, tested the way the cross-tenant suite (spec §9.1) asks: every
 * loader runs as workspace A's user with workspace B's ids. Each one must
 * answer "not found" or leave B out entirely, and no B row may change.
 *
 * Only the session-cookie lookup is faked. getWorkspaceContext resolves the
 * membership for real and hands back the same scoped client the app uses, so
 * these tests exercise the actual isolation, not a stand-in for it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_STAGES } from "@/lib/constants";
import { createTestDatabase, makeUser, truncateAll, type TestUser } from "@/test/action-harness";
import type { TenantFixture } from "@/test/cross-tenant";
import type { WorkspaceContext } from "@/lib/workspace-context";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
    scopeToWorkspace,
    forWorkspace: (ws: string) => scopeToWorkspace(prisma, ws),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

let currentUser: TestUser;
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => currentUser,
  requireUser: async () => currentUser,
  createSession: async () => {},
  destroySession: async () => {},
}));

// Imported after the mocks, so @/lib/db resolves to the harness database.
const { requireWorkspace } = await import("@/lib/workspace-context");
const { twoWorkspaces, snapshotWorkspace, registerCrossTenantCase } = await import(
  "@/test/cross-tenant"
);

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  vi.stubEnv("WORKSPACE_MODE", "single");
  vi.stubEnv("DEMO_MODE", "");
  await truncateAll(prisma);
  ({ a, b } = await twoWorkspaces(prisma));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** The context the app would build for this user: a real membership lookup and the scoped client. */
async function contextFor(user: TestUser): Promise<WorkspaceContext> {
  currentUser = user;
  return requireWorkspace();
}

/** Every row id a fixture owns. All are cuids, so a substring hit is a real leak. */
function rowIds(f: TenantFixture): string[] {
  return [f.owner.id, f.companyId, f.contactId, f.dealId, f.taskId, f.activityId];
}

function expectNothingFrom(value: unknown, f: TenantFixture) {
  const text = JSON.stringify(value);
  for (const id of rowIds(f)) expect(text).not.toContain(id);
}

// ---------------------------------------------------------------- contacts

const { loadContactsPage, loadContactDetail } = await import("./contacts");
registerCrossTenantCase("src/server/queries/contacts.ts#loadContactsPage");
registerCrossTenantCase("src/server/queries/contacts.ts#loadContactDetail");

describe("contacts loaders", () => {
  it("lists only the caller's workspace", async () => {
    const ctx = await contextFor(a.owner);

    const { contacts, companies } = await loadContactsPage(ctx, {});

    expect(contacts.map((c) => c.id)).toContain(a.contactId);
    expect(companies.map((c) => c.id)).toContain(a.companyId);
    expectNothingFrom({ contacts, companies }, b);
  });

  it("does not find another workspace's contact by searching for it", async () => {
    const foreign = await prisma.contact.findUniqueOrThrow({ where: { id: b.contactId } });
    const ctx = await contextFor(a.owner);

    const { contacts } = await loadContactsPage(ctx, {
      query: foreign.firstName,
      status: foreign.status,
    });

    expect(contacts.map((c) => c.id)).not.toContain(b.contactId);
  });

  it("reads another workspace's contact id as not found", async () => {
    const ctx = await contextFor(a.owner);

    expect(await loadContactDetail(ctx, b.contactId)).toBeNull();
    const own = await loadContactDetail(ctx, a.contactId);
    expect(own?.contact.id).toBe(a.contactId);
    expectNothingFrom(own, b);
  });
});

// ---------------------------------------------------------------- companies

const { loadCompaniesPage, loadCompanyDetail } = await import("./companies");
registerCrossTenantCase("src/server/queries/companies.ts#loadCompaniesPage");
registerCrossTenantCase("src/server/queries/companies.ts#loadCompanyDetail");

describe("companies loaders", () => {
  it("lists and counts only the caller's workspace", async () => {
    const ctx = await contextFor(a.owner);

    const { companies, total } = await loadCompaniesPage(ctx, {});

    expect(companies.map((c) => c.id)).toContain(a.companyId);
    expect(total).toBe(await prisma.company.count({ where: { workspaceId: a.workspaceId } }));
    expectNothingFrom(companies, b);
  });

  it("leaves another workspace's company out of a filtered total", async () => {
    const foreign = await prisma.company.findUniqueOrThrow({ where: { id: b.companyId } });
    const ctx = await contextFor(a.owner);

    const { companies, total } = await loadCompaniesPage(ctx, { query: foreign.name });

    expect(companies.map((c) => c.id)).not.toContain(b.companyId);
    expect(total).toBe(
      await prisma.company.count({
        where: {
          workspaceId: a.workspaceId,
          OR: [
            { name: { contains: foreign.name } },
            { domain: { contains: foreign.name } },
            { industry: { contains: foreign.name } },
          ],
        },
      }),
    );
  });

  it("reads another workspace's company id as not found", async () => {
    const ctx = await contextFor(a.owner);

    expect(await loadCompanyDetail(ctx, b.companyId)).toBeNull();
    const own = await loadCompanyDetail(ctx, a.companyId);
    expect(own?.id).toBe(a.companyId);
    expectNothingFrom(own, b);
  });
});

// ---------------------------------------------------------------- deals

const { loadDealsBoard, loadDealDetail, loadDealTitle } = await import("./deals");
registerCrossTenantCase("src/server/queries/deals.ts#loadDealsBoard");
registerCrossTenantCase("src/server/queries/deals.ts#loadDealDetail");
registerCrossTenantCase("src/server/queries/deals.ts#loadDealTitle");

describe("deals loaders", () => {
  it("puts only the caller's deals, contacts and companies on the board", async () => {
    const ctx = await contextFor(a.owner);

    const board = await loadDealsBoard(ctx);

    expect(board.deals.map((d) => d.id)).toContain(a.dealId);
    expect(board.contacts.map((c) => c.id)).toContain(a.contactId);
    expect(board.companies.map((c) => c.id)).toContain(a.companyId);
    expectNothingFrom(board, b);
  });

  it("reads another workspace's deal id as not found", async () => {
    const ctx = await contextFor(a.owner);

    expect(await loadDealDetail(ctx, b.dealId)).toBeNull();
    const own = await loadDealDetail(ctx, a.dealId);
    expect(own?.deal.id).toBe(a.dealId);
    expectNothingFrom(own, b);
  });

  // generateMetadata puts this string in the browser tab. Another workspace's
  // deal title must not reach it, even for a URL typed by hand.
  it("never returns another workspace's deal title", async () => {
    const ctx = await contextFor(a.owner);
    const own = await prisma.deal.findUniqueOrThrow({ where: { id: a.dealId } });

    expect(await loadDealTitle(ctx, b.dealId)).toBeNull();
    expect(await loadDealTitle(ctx, a.dealId)).toBe(own.title);
  });
});

// ---------------------------------------------------------------- dashboard

const { loadDashboard } = await import("./dashboard");
registerCrossTenantCase("src/server/queries/dashboard.ts#loadDashboard");

describe("dashboard loader", () => {
  const since = () => new Date(Date.now() - 30 * 86400_000);
  const sum = (rows: { baseValue: number }[]) => rows.reduce((s, r) => s + r.baseValue, 0);

  it("aggregates only the caller's workspace", async () => {
    // Loud numbers in B, so a leak cannot hide inside a sum.
    await prisma.deal.create({
      data: {
        title: "B whale",
        value: 7_777_777,
        baseValue: 7_777_777,
        stage: "PROPOSAL",
        position: 99,
        ownerId: b.owner.id,
        workspaceId: b.workspaceId,
      },
    });
    await prisma.deal.create({
      data: {
        title: "B won",
        value: 5_555_555,
        baseValue: 5_555_555,
        stage: "WON",
        closedAt: new Date(),
        position: 99,
        ownerId: b.owner.id,
        workspaceId: b.workspaceId,
      },
    });
    await prisma.contact.create({
      data: { firstName: "Bea", lastName: "Fresh", ownerId: b.owner.id, workspaceId: b.workspaceId },
    });
    const newContactsSince = since();
    const ctx = await contextFor(a.owner);

    const d = await loadDashboard(ctx, { newContactsSince });

    const rawOpen = await prisma.deal.findMany({
      where: { workspaceId: a.workspaceId, stage: { in: [...OPEN_STAGES] } },
      select: { baseValue: true },
    });
    const rawClosed = await prisma.deal.findMany({
      where: { workspaceId: a.workspaceId, stage: { in: ["WON", "LOST"] } },
      select: { baseValue: true },
    });
    expect(d.openDeals).toHaveLength(rawOpen.length);
    expect(sum(d.openDeals)).toBe(sum(rawOpen));
    expect(d.closedDeals).toHaveLength(rawClosed.length);
    expect(sum(d.closedDeals)).toBe(sum(rawClosed));
    expect(d.newContacts).toBe(
      await prisma.contact.count({
        where: { workspaceId: a.workspaceId, createdAt: { gte: newContactsSince } },
      }),
    );
  });

  it("lists the caller's own tasks and activity, and nothing from another workspace", async () => {
    // A task in B assigned to A's owner. The assignee filter alone would show
    // it; only the workspace scope keeps it off A's dashboard.
    const strayTask = await prisma.task.create({
      data: { title: "B task", assigneeId: a.owner.id, workspaceId: b.workspaceId },
    });
    const strayActivity = await prisma.activity.create({
      data: {
        type: "NOTE",
        content: "B note",
        userId: b.owner.id,
        contactId: b.contactId,
        workspaceId: b.workspaceId,
      },
    });
    const ownTask = await prisma.task.create({
      data: { title: "A task", assigneeId: a.owner.id, workspaceId: a.workspaceId },
    });
    const ownActivity = await prisma.activity.create({
      data: {
        type: "CALL",
        content: "A call",
        userId: a.owner.id,
        contactId: a.contactId,
        workspaceId: a.workspaceId,
      },
    });
    const ctx = await contextFor(a.owner);

    const d = await loadDashboard(ctx, { newContactsSince: since() });

    expect(d.tasks.map((t) => t.id)).toContain(ownTask.id);
    expect(d.tasks.map((t) => t.id)).not.toContain(strayTask.id);
    expect(d.activities.map((x) => x.id)).toContain(ownActivity.id);
    expect(d.activities.map((x) => x.id)).not.toContain(strayActivity.id);
    expectNothingFrom(d, b);
  });
});

// ---------------------------------------------------------------- settings

const { loadSettings } = await import("./settings");
registerCrossTenantCase("src/server/queries/settings.ts#loadSettings");

describe("settings loader", () => {
  async function auditRows() {
    await prisma.auditLog.create({
      data: {
        action: "contact.update",
        entityType: "contact",
        entityId: a.contactId,
        userId: a.owner.id,
        workspaceId: a.workspaceId,
      },
    });
    await prisma.auditLog.create({
      data: {
        action: "contact.update",
        entityType: "contact",
        entityId: b.contactId,
        userId: b.owner.id,
        workspaceId: b.workspaceId,
      },
    });
    // A platform row: no workspace, and the kind that carries a caller's IP.
    await prisma.auditLog.create({
      data: {
        action: "auth.login_failed",
        entityType: "user",
        entityId: "unknown",
        userId: null,
        metadata: JSON.stringify({ ip: "203.0.113.77" }),
      },
    });
  }

  async function memberIds(workspaceId: string) {
    const rows = await prisma.membership.findMany({ where: { workspaceId }, select: { userId: true } });
    return rows.map((r) => r.userId).sort();
  }

  it("lists only the caller's workspace, with every address for an admin", async () => {
    const admin = await makeUser(prisma, {
      email: "ada@a.example",
      name: "Ada Admin",
      role: "ADMIN",
      workspaceId: a.workspaceId,
    });
    const member = await makeUser(prisma, {
      email: "mo@a.example",
      name: "Mo Member",
      role: "MEMBER",
      workspaceId: a.workspaceId,
    });

    const { roster, isAdmin } = await loadSettings(await contextFor(admin));

    expect(isAdmin).toBe(true);
    expect(roster.map((m) => m.id).sort()).toEqual(await memberIds(a.workspaceId));
    expect(roster.map((m) => m.id)).not.toContain(b.owner.id);
    expect(roster.find((m) => m.id === member.id)?.email).toBe("mo@a.example");
    expect(roster.every((m) => m.email !== null)).toBe(true);
    expectNothingFrom(roster, b);
  });

  it("shows a member their own address and nobody else's", async () => {
    const member = await makeUser(prisma, {
      email: "mo@a.example",
      name: "Mo Member",
      role: "MEMBER",
      workspaceId: a.workspaceId,
    });

    const { roster, isAdmin } = await loadSettings(await contextFor(member));

    expect(isAdmin).toBe(false);
    expect(roster.length).toBeGreaterThan(1);
    for (const m of roster) expect(m.email).toBe(m.id === member.id ? "mo@a.example" : null);
  });

  // The demo's admin password is published on the landing page. Anyone who
  // signs in as it must not be able to read who else has registered.
  it("never shows the locked demo account another member's address", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const demo = await makeUser(prisma, {
      email: "demo@nexuscrm.dev",
      name: "Demo User",
      role: "ADMIN",
      workspaceId: a.workspaceId,
    });

    const { roster, isAdmin } = await loadSettings(await contextFor(demo));

    expect(isAdmin).toBe(true);
    expect(roster.some((m) => m.id === a.owner.id)).toBe(true);
    for (const m of roster) expect(m.email).toBe(m.id === demo.id ? "demo@nexuscrm.dev" : null);
  });

  it("lets the same account on a private install see addresses", async () => {
    // DEMO_MODE unset: a self-hosted install seeded with the demo account keeps full control.
    const demo = await makeUser(prisma, {
      email: "demo@nexuscrm.dev",
      name: "Demo User",
      role: "ADMIN",
      workspaceId: a.workspaceId,
    });

    const { roster } = await loadSettings(await contextFor(demo));

    expect(roster.find((m) => m.id === a.owner.id)?.email).toBe(a.owner.email);
  });

  it("badges owners and admins, and nobody else, as admins", async () => {
    const admin = await makeUser(prisma, {
      email: "ada@a.example",
      role: "ADMIN",
      workspaceId: a.workspaceId,
    });
    const member = await makeUser(prisma, {
      email: "mo@a.example",
      role: "MEMBER",
      workspaceId: a.workspaceId,
    });

    const { roster } = await loadSettings(await contextFor(admin));

    const memberships = await prisma.membership.findMany({ where: { workspaceId: a.workspaceId } });
    for (const m of roster) {
      const role = memberships.find((x) => x.userId === m.id)!.role;
      expect(m.role).toBe(role);
      expect(m.isAdmin).toBe(role === "OWNER" || role === "ADMIN");
    }
    expect(roster.find((m) => m.id === admin.id)?.isAdmin).toBe(true);
    expect(roster.find((m) => m.id === member.id)?.isAdmin).toBe(false);
  });

  it("shows an admin this workspace's audit events and never a platform row", async () => {
    await auditRows();
    const admin = await makeUser(prisma, {
      email: "ada@a.example",
      role: "ADMIN",
      workspaceId: a.workspaceId,
    });

    const { auditEntries } = await loadSettings(await contextFor(admin));

    expect(auditEntries.map((e) => e.entityId)).toContain(a.contactId);
    for (const e of auditEntries) {
      expect(e.workspaceId).toBe(a.workspaceId);
      expect(e.action.startsWith("auth.")).toBe(false);
    }
    expect(JSON.stringify(auditEntries)).not.toContain("203.0.113.77");
    expectNothingFrom(auditEntries, b);
  });

  it("does not load the audit log for a member", async () => {
    await auditRows();
    const member = await makeUser(prisma, {
      email: "mo@a.example",
      role: "MEMBER",
      workspaceId: a.workspaceId,
    });

    const { auditEntries } = await loadSettings(await contextFor(member));

    expect(auditEntries).toEqual([]);
  });
});

// ---------------------------------------------------------------- all loaders

describe("every loader, as workspace A with workspace B's ids", () => {
  it("changes no row in workspace B", async () => {
    const before = await snapshotWorkspace(prisma, b.workspaceId);
    const ctx = await contextFor(a.owner);

    await loadContactsPage(ctx, {});
    await loadContactDetail(ctx, b.contactId);
    await loadCompaniesPage(ctx, {});
    await loadCompanyDetail(ctx, b.companyId);
    await loadDealsBoard(ctx);
    await loadDealDetail(ctx, b.dealId);
    await loadDealTitle(ctx, b.dealId);
    await loadDashboard(ctx, { newContactsSince: new Date(0) });
    await loadSettings(ctx);

    expect(await snapshotWorkspace(prisma, b.workspaceId)).toBe(before);
  });
});
