/**
 * Activities and tasks across two workspaces (spec §9.1; Review Focus 3).
 *
 * Both create actions attach to records named by id, which is exactly where a
 * tampered form would try to reach another workspace. Every export is called as
 * an ADMIN of workspace A with workspace B's ids. The expected answer is the
 * same as for a record deleted under a stale tab: "no longer exists", nothing
 * written, and no row of B changed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  formData,
  makeUser,
  truncateAll,
  type TestUser,
} from "@/test/action-harness";
import {
  registerCrossTenantCase,
  snapshotWorkspace,
  twoWorkspaces,
  type TenantFixture,
} from "@/test/cross-tenant";
import { missingRelationMessage } from "@/lib/relations";

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

let currentUser: TestUser | null = null;
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => currentUser,
  requireUser: async () => currentUser,
  createSession: async () => {},
  destroySession: async () => {},
}));

const { createActivity, deleteActivity } = await import("./activities");
const { createTask, toggleTask, deleteTask } = await import("./tasks");

let a: TenantFixture;
let b: TenantFixture;
let actor: TestUser;
let bBefore: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  await truncateAll(prisma);
  ({ a, b } = await twoWorkspaces(prisma));
  actor = await makeUser(prisma, {
    email: "xt-admin@a.example",
    name: "Ada Admin",
    role: "ADMIN",
    workspaceId: a.workspaceId,
  });
  currentUser = actor;
  bBefore = await snapshotWorkspace(prisma, b.workspaceId);
});

async function expectBUnchanged() {
  expect(await snapshotWorkspace(prisma, b.workspaceId)).toBe(bBefore);
}

describe("activities.ts", () => {
  registerCrossTenantCase("src/server/actions/activities.ts#createActivity");
  registerCrossTenantCase("src/server/actions/activities.ts#deleteActivity");

  const links = [
    { field: "contactId", relation: "contact" },
    { field: "dealId", relation: "deal" },
    { field: "companyId", relation: "company" },
  ] as const;

  for (const { field, relation } of links) {
    it(`createActivity on B's ${relation} says it no longer exists and writes nothing`, async () => {
      const content = `Tampered ${relation} note`;

      const result = await createActivity(
        {},
        formData({ type: "NOTE", content, [field]: b[field] }),
      );

      expect(result.message).toBe(missingRelationMessage(relation));
      expect(await prisma.activity.count({ where: { content } })).toBe(0);
      await expectBUnchanged();
    });
  }

  it("createActivity mixing A's contact with B's deal is refused as a whole", async () => {
    const result = await createActivity(
      {},
      formData({ type: "NOTE", content: "Mixed note", contactId: a.contactId, dealId: b.dealId }),
    );

    expect(result.message).toBe(missingRelationMessage("deal"));
    expect(await prisma.activity.count({ where: { content: "Mixed note" } })).toBe(0);
    await expectBUnchanged();
  });

  it("createActivity on A's own contact writes into A", async () => {
    const result = await createActivity(
      {},
      formData({ type: "CALL", content: "Own call", contactId: a.contactId }),
    );

    expect(result.success).toBe(true);
    const row = await prisma.activity.findFirstOrThrow({ where: { content: "Own call" } });
    expect(row.workspaceId).toBe(a.workspaceId);
    expect(row.userId).toBe(actor.id);
  });

  it("deleteActivity on B's activity is a no-op", async () => {
    await expect(deleteActivity(b.activityId)).resolves.toBeUndefined();
    expect(await prisma.activity.count({ where: { id: b.activityId } })).toBe(1);
    await expectBUnchanged();
  });
});

describe("tasks.ts", () => {
  registerCrossTenantCase("src/server/actions/tasks.ts#createTask");
  registerCrossTenantCase("src/server/actions/tasks.ts#toggleTask");
  registerCrossTenantCase("src/server/actions/tasks.ts#deleteTask");

  const links = [
    { field: "contactId", relation: "contact" },
    { field: "dealId", relation: "deal" },
  ] as const;

  for (const { field, relation } of links) {
    it(`createTask on B's ${relation} says it no longer exists and writes nothing`, async () => {
      const title = `Tampered ${relation} task`;

      const result = await createTask({}, formData({ title, [field]: b[field] }));

      expect(result.message).toBe(missingRelationMessage(relation));
      expect(await prisma.task.count({ where: { title } })).toBe(0);
      await expectBUnchanged();
    });
  }

  it("createTask on A's own deal writes into A", async () => {
    const result = await createTask({}, formData({ title: "Own task", dealId: a.dealId }));

    expect(result.success).toBe(true);
    const row = await prisma.task.findFirstOrThrow({ where: { title: "Own task" } });
    expect(row.workspaceId).toBe(a.workspaceId);
    expect(row.assigneeId).toBe(actor.id);
  });

  it("toggleTask on B's task is a no-op", async () => {
    await expect(toggleTask(b.taskId)).resolves.toBeUndefined();
    await expectBUnchanged();
  });

  it("deleteTask on B's task is a no-op", async () => {
    await expect(deleteTask(b.taskId)).resolves.toBeUndefined();
    expect(await prisma.task.count({ where: { id: b.taskId } })).toBe(1);
    await expectBUnchanged();
  });
});
