/**
 * The nightly demo reset, unit by unit (spec §8, §9.6). assertResettable is
 * the guard; resetDemoWorkspace is the work, tested alone against a database
 * with two workspaces so its delete scope is proven rather than assumed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeUser, makeWorkspace, truncateAll } from "@/test/action-harness";
import { snapshotWorkspace } from "@/test/cross-tenant";
import { DEMO_EMAIL } from "./demo-guard";
import { assertResettable, resetDemoWorkspace } from "./demo-reset";

const { prisma, destroy } = createTestDatabase();
const DAY = 86_400_000;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  await truncateAll(prisma);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A visitor's worth of CRM rows, linked the way the app links them. */
async function visitorRows(workspaceId: string | null, ownerId: string, label: string) {
  const company = await prisma.company.create({ data: { name: `${label} Co`, ownerId, workspaceId } });
  const contact = await prisma.contact.create({
    data: { firstName: label, lastName: "Visitor", status: "LEAD", ownerId, companyId: company.id, workspaceId },
  });
  const deal = await prisma.deal.create({
    data: { title: `${label} deal`, ownerId, contactId: contact.id, companyId: company.id, workspaceId },
  });
  await prisma.activity.create({
    data: { type: "NOTE", content: `${label} note`, userId: ownerId, contactId: contact.id, workspaceId },
  });
  await prisma.task.create({ data: { title: `${label} task`, assigneeId: ownerId, dealId: deal.id, workspaceId } });
}

async function crmCounts(workspaceId: string | null) {
  const where = { workspaceId };
  return Promise.all([
    prisma.company.count({ where }),
    prisma.contact.count({ where }),
    prisma.deal.count({ where }),
    prisma.activity.count({ where }),
    prisma.task.count({ where }),
  ]);
}

describe("assertResettable", () => {
  it("refuses a database with no workspace", async () => {
    await expect(assertResettable(prisma)).rejects.toThrow("RESET_REFUSED: this database has no workspace");
  });

  it("refuses when the only workspace is not marked as the demo", async () => {
    await makeWorkspace(prisma, { id: "ws_selfhost", slug: "selfhost", isDemo: false });

    await expect(assertResettable(prisma)).rejects.toThrow(
      "RESET_REFUSED: workspace ws_selfhost is not marked as the demo",
    );
  });

  it("refuses more than one workspace, even when every one is marked", async () => {
    await makeWorkspace(prisma, { id: "ws_a", slug: "a", isDemo: true });
    await makeWorkspace(prisma, { id: "ws_b", slug: "b", isDemo: true });

    await expect(assertResettable(prisma)).rejects.toThrow(
      "RESET_REFUSED: this database has more than one workspace",
    );
  });

  it("returns the only workspace when it is marked as the demo", async () => {
    await makeWorkspace(prisma, { id: "ws_demo", slug: "demo", isDemo: true });

    expect(await assertResettable(prisma)).toEqual({ workspaceId: "ws_demo" });
  });
});

describe("resetDemoWorkspace", () => {
  it("deletes only its own workspace's rows and rows with no workspace, then reseeds it", async () => {
    const demoWs = await makeWorkspace(prisma, { id: "ws_demo", slug: "demo", isDemo: true });
    const otherWs = await makeWorkspace(prisma, { id: "ws_other", slug: "other" });
    await makeUser(prisma, { email: DEMO_EMAIL, role: "ADMIN", workspaceId: demoWs.id });
    const visitor = await makeUser(prisma, { email: "visitor@example.com", workspaceId: demoWs.id });
    const resident = await makeUser(prisma, { email: "resident@example.com", role: "OWNER", workspaceId: otherWs.id });
    await visitorRows(demoWs.id, visitor.id, "Demo");
    await visitorRows(null, visitor.id, "Orphan");
    await visitorRows(otherWs.id, resident.id, "Other");
    const otherBefore = await snapshotWorkspace(prisma, otherWs.id);

    await resetDemoWorkspace(prisma, demoWs.id);

    expect(await snapshotWorkspace(prisma, otherWs.id)).toBe(otherBefore);
    expect(await crmCounts(null)).toEqual([0, 0, 0, 0, 0]);
    expect(await prisma.contact.count({ where: { firstName: { in: ["Demo", "Orphan"] } } })).toBe(0);
    expect(await crmCounts(demoWs.id)).toEqual([6, 12, 14, 10, 7]);
    // Accounts are never touched.
    expect(await prisma.user.count()).toBe(3);
  });

  it("never writes isDemo", async () => {
    const ws = await makeWorkspace(prisma, { id: "ws_demo", slug: "demo", isDemo: true });
    await makeUser(prisma, { email: DEMO_EMAIL, role: "ADMIN", workspaceId: ws.id });
    const before = await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    const writes = [
      vi.spyOn(prisma.workspace, "create"),
      vi.spyOn(prisma.workspace, "createMany"),
      vi.spyOn(prisma.workspace, "createManyAndReturn"),
      vi.spyOn(prisma.workspace, "update"),
      vi.spyOn(prisma.workspace, "updateMany"),
      vi.spyOn(prisma.workspace, "updateManyAndReturn"),
      vi.spyOn(prisma.workspace, "upsert"),
      vi.spyOn(prisma.workspace, "delete"),
      vi.spyOn(prisma.workspace, "deleteMany"),
    ];

    await resetDemoWorkspace(prisma, ws.id);

    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    const after = await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(after.isDemo).toBe(true);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("re-upserts the demo account's ADMIN membership", async () => {
    const ws = await makeWorkspace(prisma, { id: "ws_demo", slug: "demo", isDemo: true });
    const demo = await makeUser(prisma, { email: DEMO_EMAIL, role: "MEMBER", workspaceId: ws.id });

    await resetDemoWorkspace(prisma, ws.id);

    expect(await prisma.membership.findUniqueOrThrow({ where: { userId: demo.id } })).toMatchObject({
      workspaceId: ws.id,
      role: "ADMIN",
    });
  });

  it("creates the demo account and its ADMIN membership when neither exists, and never a workspace", async () => {
    const ws = await makeWorkspace(prisma, { id: "ws_demo", slug: "demo", isDemo: true });

    await resetDemoWorkspace(prisma, ws.id);

    const demo = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    expect(await prisma.membership.findUniqueOrThrow({ where: { userId: demo.id } })).toMatchObject({
      workspaceId: ws.id,
      role: "ADMIN",
    });
    expect(await prisma.contact.count({ where: { workspaceId: ws.id, ownerId: demo.id } })).toBe(12);
    expect(await prisma.workspace.count()).toBe(1);
  });

  it("refuses, before deleting anything, when the demo account belongs to another workspace", async () => {
    const demoWs = await makeWorkspace(prisma, { id: "ws_demo", slug: "demo", isDemo: true });
    const otherWs = await makeWorkspace(prisma, { id: "ws_other", slug: "other" });
    await makeUser(prisma, { email: DEMO_EMAIL, role: "ADMIN", workspaceId: otherWs.id });
    const visitor = await makeUser(prisma, { email: "visitor@example.com", workspaceId: demoWs.id });
    await visitorRows(demoWs.id, visitor.id, "Demo");

    await expect(resetDemoWorkspace(prisma, demoWs.id)).rejects.toThrow(
      `RESET_REFUSED: ${DEMO_EMAIL} belongs to workspace ws_other, not ws_demo`,
    );
    expect(await crmCounts(demoWs.id)).toEqual([1, 1, 1, 1, 1]);
  });

  it("prunes the audit log by today's rule: the demo account's rows, and any row older than 30 days", async () => {
    const now = new Date();
    const ws = await makeWorkspace(prisma, { id: "ws_demo", slug: "demo", isDemo: true });
    const demo = await makeUser(prisma, { email: DEMO_EMAIL, role: "ADMIN", workspaceId: ws.id });
    const real = await makeUser(prisma, { email: "real@example.com", workspaceId: ws.id });
    const entry = (
      action: string,
      userId: string | null,
      workspaceId: string | null,
      ageDays: number,
    ) =>
      prisma.auditLog.create({
        data: {
          action,
          entityType: "contact",
          entityId: `${action}-${ageDays}`,
          userId,
          workspaceId,
          createdAt: new Date(now.getTime() - ageDays * DAY),
        },
      });
    const demoRecent = await entry("contact.update", demo.id, ws.id, 1);
    const realRecent = await entry("contact.update", real.id, ws.id, 2);
    const realOld = await entry("contact.update", real.id, ws.id, 40);
    const platformOld = await entry("auth.login_failed", null, null, 40);
    const platformRecent = await entry("auth.login", real.id, null, 3);

    await resetDemoWorkspace(prisma, ws.id, { now });

    const remaining = new Set((await prisma.auditLog.findMany({ select: { id: true } })).map((r) => r.id));
    expect(remaining.has(demoRecent.id)).toBe(false);
    expect(remaining.has(realOld.id)).toBe(false);
    expect(remaining.has(platformOld.id)).toBe(false);
    expect(remaining.has(realRecent.id)).toBe(true);
    expect(remaining.has(platformRecent.id)).toBe(true);
  });
});
