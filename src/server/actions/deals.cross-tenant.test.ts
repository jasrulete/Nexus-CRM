/**
 * Deals across two workspaces (spec §9.1; Review Focus 3). Every export of
 * deals.ts is called as an ADMIN of workspace A with workspace B's ids, so the
 * workspace scope is the only thing that can refuse it. Per-workspace Kanban
 * positions are pinned in deals-ordering.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  formData,
  formDataFor,
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

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
    prisma,
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

const { createDeal, updateDeal, moveDeal, deleteDeal } = await import("./deals");

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

describe("deals.ts", () => {
  registerCrossTenantCase("src/server/actions/deals.ts#createDeal");
  registerCrossTenantCase("src/server/actions/deals.ts#updateDeal");
  registerCrossTenantCase("src/server/actions/deals.ts#moveDeal");
  registerCrossTenantCase("src/server/actions/deals.ts#deleteDeal");

  it("createDeal with B's contact and company creates A's deal with neither link", async () => {
    const result = await createDeal(
      {},
      formData({
        title: "Tampered deal",
        value: "100",
        stage: "LEAD",
        contactId: b.contactId,
        companyId: b.companyId,
        workspaceId: b.workspaceId,
      }),
    );

    expect(result.success).toBe(true);
    const deal = await prisma.deal.findFirstOrThrow({ where: { title: "Tampered deal" } });
    expect(deal.workspaceId).toBe(a.workspaceId);
    expect(deal.contactId).toBeNull();
    expect(deal.companyId).toBeNull();
    await expectBUnchanged();
  });

  it("updateDeal on B's deal is not found and writes nothing", async () => {
    // B's real version, so a broken scope would pass the stale check and write.
    const target = await prisma.deal.findUniqueOrThrow({ where: { id: b.dealId } });

    const result = await updateDeal(
      b.dealId,
      {},
      formDataFor(target, { title: "Hijacked", value: "1", stage: "WON" }),
    );

    expect(result.message).toBe("Deal not found");
    await expectBUnchanged();
  });

  it("updateDeal on A's own deal drops B's contact and company", async () => {
    const own = await prisma.deal.findUniqueOrThrow({ where: { id: a.dealId } });

    const result = await updateDeal(
      a.dealId,
      {},
      formDataFor(own, {
        title: "Own deal",
        value: String(own.value),
        stage: own.stage,
        currency: own.currency,
        contactId: b.contactId,
        companyId: b.companyId,
      }),
    );

    expect(result.success).toBe(true);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: a.dealId } });
    expect(after.contactId).toBeNull();
    expect(after.companyId).toBeNull();
    await expectBUnchanged();
  });

  it("moveDeal on B's deal is refused and B's board is untouched", async () => {
    expect(await moveDeal({ dealId: b.dealId, stage: "WON", position: 0 })).toEqual({ ok: false });
    await expectBUnchanged();
  });

  it("deleteDeal on B's deal leaves the page without deleting anything", async () => {
    await expect(deleteDeal(b.dealId)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.deal.count({ where: { id: b.dealId } })).toBe(1);
    await expectBUnchanged();
  });
});
