import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, truncateAll } from "./action-harness";
import {
  CASE_KEY,
  CROSS_TENANT_EXEMPT,
  crossTenantCases,
  registerCrossTenantCase,
  snapshotWorkspace,
  twoWorkspaces,
  type TenantFixture,
} from "./cross-tenant";

const { prisma, destroy } = createTestDatabase();

afterAll(async () => {
  await destroy();
});

let a: TenantFixture;
let b: TenantFixture;

beforeEach(async () => {
  await truncateAll(prisma);
  ({ a, b } = await twoWorkspaces(prisma));
});

describe("twoWorkspaces", () => {
  it("seeds two disjoint workspaces, each owned by an OWNER", () => {
    expect(a.workspaceId).not.toBe(b.workspaceId);
    expect(a.owner).toMatchObject({ role: "OWNER", workspaceId: a.workspaceId });
    expect(b.owner).toMatchObject({ role: "OWNER", workspaceId: b.workspaceId });
  });

  it("stamps every seeded row with its own workspace", async () => {
    for (const t of [a, b]) {
      const where = { workspaceId: t.workspaceId };
      expect((await prisma.company.findMany({ where })).map((r) => r.id)).toEqual([t.companyId]);
      expect((await prisma.contact.findMany({ where })).map((r) => r.id)).toEqual([t.contactId]);
      expect((await prisma.deal.findMany({ where })).map((r) => r.id)).toEqual([t.dealId]);
      expect((await prisma.task.findMany({ where })).map((r) => r.id)).toEqual([t.taskId]);
      expect((await prisma.activity.findMany({ where })).map((r) => r.id)).toEqual([t.activityId]);
      expect(await prisma.auditLog.count({ where })).toBe(1);
      expect(await prisma.aiUsage.count({ where })).toBe(0); // AI tests seed their own usage rows
      expect(await prisma.membership.count({ where })).toBe(1);
    }
  });

  it("links each workspace's rows only to each other", async () => {
    for (const t of [a, b]) {
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: t.dealId } });
      expect(deal).toMatchObject({ contactId: t.contactId, companyId: t.companyId, ownerId: t.owner.id });
      const task = await prisma.task.findUniqueOrThrow({ where: { id: t.taskId } });
      expect(task).toMatchObject({ contactId: t.contactId, dealId: t.dealId, assigneeId: t.owner.id });
      const activity = await prisma.activity.findUniqueOrThrow({ where: { id: t.activityId } });
      expect(activity).toMatchObject({
        contactId: t.contactId,
        dealId: t.dealId,
        companyId: t.companyId,
        userId: t.owner.id,
      });
    }
  });
});

describe("snapshotWorkspace", () => {
  it("is stable when nothing changes", async () => {
    expect(await snapshotWorkspace(prisma, b.workspaceId)).toBe(await snapshotWorkspace(prisma, b.workspaceId));
  });

  it("ignores a change in the other workspace", async () => {
    const before = await snapshotWorkspace(prisma, b.workspaceId);
    await prisma.contact.update({ where: { id: a.contactId }, data: { firstName: "Changed" } });

    expect(await snapshotWorkspace(prisma, b.workspaceId)).toBe(before);
  });

  it.each([
    ["a contact edit", () => prisma.contact.update({ where: { id: b.contactId }, data: { firstName: "Changed" } })],
    ["a deal edit", () => prisma.deal.update({ where: { id: b.dealId }, data: { title: "Changed" } })],
    ["an activity edit", () => prisma.activity.update({ where: { id: b.activityId }, data: { content: "Changed" } })],
    ["a membership role change", () => prisma.membership.update({ where: { userId: b.owner.id }, data: { role: "MEMBER" } })],
    ["a new AI usage row", () => prisma.aiUsage.create({ data: { workspaceId: b.workspaceId, action: "score", outcome: "pending" } })],
    ["a deleted task", () => prisma.task.delete({ where: { id: b.taskId } })],
    ["a row moved out", () => prisma.company.update({ where: { id: b.companyId }, data: { workspaceId: a.workspaceId } })],
    ["a member's renamed user", () => prisma.user.update({ where: { id: b.owner.id }, data: { name: "Changed" } })],
    ["a plan change", () => prisma.workspace.update({ where: { id: b.workspaceId }, data: { plan: "PAID" } })],
    ["a new audit row", () => prisma.auditLog.create({ data: { action: "x", entityType: "x", entityId: "x", workspaceId: b.workspaceId } })],
  ])("detects %s", async (_name, change) => {
    const before = await snapshotWorkspace(prisma, b.workspaceId);
    await change();

    expect(await snapshotWorkspace(prisma, b.workspaceId)).not.toBe(before);
  });
});

describe("the case registry", () => {
  it.each([
    "src/lib/workspace-mode.ts#workspaceMode",
    // Route groups, dynamic segments and .tsx are part of the shared pattern.
    "src/app/(app)/contacts/[id]/page.tsx#default",
  ])("records the well-formed key %j", (key) => {
    registerCrossTenantCase(key);

    expect(CASE_KEY.test(key)).toBe(true);
    expect(crossTenantCases.has(key)).toBe(true);
  });

  it.each(["updateContact", "src/server/actions/contacts.ts", "server/actions/contacts.ts#x", "src/a.ts#", "src/a.ts#1x"])(
    "refuses the malformed key %j",
    (key) => {
      expect(() => registerCrossTenantCase(key)).toThrow(/Cross-tenant case keys/);
    },
  );

  it("exempts only the AI exports that never touch the database", () => {
    expect(CROSS_TENANT_EXEMPT).toEqual({ "src/server/actions/ai.ts": ["extractFileText", "currentAiProvider"] });
  });
});
