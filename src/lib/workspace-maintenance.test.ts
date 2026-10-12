/**
 * The helpers behind the one-off workspace scripts and the seed/reset mode
 * guard. They run against production only by hand, with the user's go
 * (docs/runbooks/2026-10-tenancy-phase-a.md), so every refusal is pinned here
 * on a throwaway database first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, makeUser, makeWorkspace, truncateAll } from "@/test/action-harness";
import { DEMO_EMAIL } from "./demo-guard";
import { DEFAULT_WORKSPACE_ID } from "./workspace-bootstrap";
import { assertScriptMode, backfillWorkspace, markDemoWorkspace } from "./workspace-maintenance";

const { prisma, destroy } = createTestDatabase();

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  await truncateAll(prisma);
});

const NOTHING = {
  memberships: 0,
  companies: 0,
  contacts: 0,
  deals: 0,
  activities: 0,
  tasks: 0,
  auditLogs: 0,
};

describe("assertScriptMode", () => {
  it("refuses multi mode, naming the script", () => {
    expect(() => assertScriptMode("db:seed", { WORKSPACE_MODE: "multi" })).toThrow(
      "db:seed refuses to run when WORKSPACE_MODE=multi",
    );
  });

  it("allows single mode, and an unset mode outside production", () => {
    expect(() => assertScriptMode("db:seed", { WORKSPACE_MODE: "single" })).not.toThrow();
    expect(() => assertScriptMode("db:seed", {})).not.toThrow();
  });

  it("refuses an unset mode in production, the same rule the app boots by", () => {
    expect(() => assertScriptMode("db:seed", { NODE_ENV: "production" })).toThrow(
      "WORKSPACE_MODE is required in production",
    );
  });
});

describe("markDemoWorkspace", () => {
  async function demoDatabase() {
    const ws = await makeWorkspace(prisma, { id: DEFAULT_WORKSPACE_ID, slug: "default" });
    await makeUser(prisma, { email: DEMO_EMAIL, role: "ADMIN", workspaceId: ws.id });
    return ws;
  }
  const flagged = () => prisma.workspace.count({ where: { isDemo: true } });

  it("marks the only workspace when the demo account is a member of it", async () => {
    const ws = await demoDatabase();

    expect(await markDemoWorkspace(prisma)).toEqual({ workspaceId: ws.id, changed: true });
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } })).isDemo).toBe(true);
  });

  it("is idempotent", async () => {
    const ws = await demoDatabase();
    await markDemoWorkspace(prisma);

    expect(await markDemoWorkspace(prisma)).toEqual({ workspaceId: ws.id, changed: false });
  });

  it("refuses a database with no workspace", async () => {
    await expect(markDemoWorkspace(prisma)).rejects.toThrow(
      "MARK_REFUSED: expected exactly one workspace, found none",
    );
  });

  it("refuses a database with more than one workspace and marks neither", async () => {
    await demoDatabase();
    await makeWorkspace(prisma, { id: "ws_second", slug: "second" });

    await expect(markDemoWorkspace(prisma)).rejects.toThrow(
      "MARK_REFUSED: expected exactly one workspace, found more than one",
    );
    expect(await flagged()).toBe(0);
  });

  it("refuses a workspace the demo account does not exist in — a self-hosted install", async () => {
    const ws = await makeWorkspace(prisma, { id: DEFAULT_WORKSPACE_ID, slug: "default" });
    await makeUser(prisma, { email: "owner@selfhost.example", role: "OWNER", workspaceId: ws.id });

    await expect(markDemoWorkspace(prisma)).rejects.toThrow(
      `MARK_REFUSED: ${DEMO_EMAIL} does not exist on this database`,
    );
    expect(await flagged()).toBe(0);
  });

  it("refuses when the demo account is not a member of the workspace", async () => {
    await makeWorkspace(prisma, { id: DEFAULT_WORKSPACE_ID, slug: "default" });
    await prisma.user.create({
      data: { email: DEMO_EMAIL, name: "Demo User", passwordHash: "not-a-real-hash" },
    });

    await expect(markDemoWorkspace(prisma)).rejects.toThrow(
      `MARK_REFUSED: ${DEMO_EMAIL} is not a member of workspace ${DEFAULT_WORKSPACE_ID}`,
    );
    expect(await flagged()).toBe(0);
  });
});

describe("backfillWorkspace", () => {
  /** What the old build can leave between M1 and the phase-A deploy (spec §10 step 8). */
  async function oldBuildWindow() {
    const ws = await makeWorkspace(prisma, { id: DEFAULT_WORKSPACE_ID, slug: "default" });
    const member = await makeUser(prisma, { email: "member@example.com", workspaceId: ws.id });
    // Registered by the old build after M1 ran: a user with no membership.
    const late = await prisma.user.create({
      data: { email: "late@example.com", name: "Late Registrant", passwordHash: "not-a-real-hash" },
    });
    // Rows the old build wrote without a workspace.
    const company = await prisma.company.create({ data: { name: "Window Co", ownerId: late.id } });
    const contact = await prisma.contact.create({
      data: { firstName: "Window", lastName: "Row", status: "LEAD", ownerId: late.id, companyId: company.id },
    });
    const deal = await prisma.deal.create({
      data: { title: "Window deal", ownerId: late.id, contactId: contact.id },
    });
    await prisma.activity.create({
      data: { type: "NOTE", content: "Window note", userId: late.id, contactId: contact.id },
    });
    await prisma.task.create({ data: { title: "Window task", assigneeId: late.id, dealId: deal.id } });
    await prisma.auditLog.create({
      data: { action: "contact.create", entityType: "contact", entityId: contact.id, userId: late.id },
    });
    await prisma.auditLog.create({
      data: { action: "auth.login", entityType: "user", entityId: late.id, userId: late.id },
    });
    return { ws, member, late };
  }

  async function unscopedCounts() {
    const none = { workspaceId: null };
    return Promise.all([
      prisma.company.count({ where: none }),
      prisma.contact.count({ where: none }),
      prisma.deal.count({ where: none }),
      prisma.activity.count({ where: none }),
      prisma.task.count({ where: none }),
    ]);
  }

  it("joins users without a membership as MEMBER and stamps every unscoped row except platform audit events", async () => {
    const { ws, member, late } = await oldBuildWindow();

    expect(await backfillWorkspace(prisma)).toEqual({
      memberships: 1,
      companies: 1,
      contacts: 1,
      deals: 1,
      activities: 1,
      tasks: 1,
      auditLogs: 1,
    });

    // Written the way M1 writes it: id mem_<userId>, and the user's own
    // createdAt rather than the time of the backfill.
    expect(await prisma.membership.findUniqueOrThrow({ where: { userId: late.id } })).toMatchObject({
      id: `mem_${late.id}`,
      workspaceId: ws.id,
      role: "MEMBER",
      createdAt: late.createdAt,
    });
    // An existing membership keeps its role.
    expect((await prisma.membership.findUniqueOrThrow({ where: { userId: member.id } })).role).toBe(
      member.role,
    );
    expect(await unscopedCounts()).toEqual([0, 0, 0, 0, 0]);
    expect(
      (await prisma.auditLog.findFirstOrThrow({ where: { action: "contact.create" } })).workspaceId,
    ).toBe(ws.id);
    // Platform events stay null: they are never shown to a workspace.
    expect(
      (await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.login" } })).workspaceId,
    ).toBeNull();
  });

  it("changes nothing on a second run", async () => {
    await oldBuildWindow();
    await backfillWorkspace(prisma);

    expect(await backfillWorkspace(prisma)).toEqual(NOTHING);
  });

  it("refuses a database with more than one workspace and changes nothing", async () => {
    await oldBuildWindow();
    await makeWorkspace(prisma, { id: "ws_second", slug: "second" });

    await expect(backfillWorkspace(prisma)).rejects.toThrow("SINGLE_MODE_VIOLATION");
    expect(await unscopedCounts()).toEqual([1, 1, 1, 1, 1]);
  });

  it("creates no workspace on an empty database", async () => {
    expect(await backfillWorkspace(prisma)).toEqual(NOTHING);
    expect(await prisma.workspace.count()).toBe(0);
  });
});
