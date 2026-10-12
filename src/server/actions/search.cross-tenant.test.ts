/**
 * Search across two workspaces (spec §5.6, §9.1). The palette reads four kinds
 * of record and their related names in one call, so every hit, and every name
 * inside one, must come from the caller's workspace.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeUser, truncateAll, type TestUser } from "@/test/action-harness";
import { registerCrossTenantCase, twoWorkspaces, type TenantFixture } from "@/test/cross-tenant";

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

const { searchRecords } = await import("./search");

let a: TenantFixture;
let b: TenantFixture;
let actor: TestUser;

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
});

/** One row of every searched kind in a workspace, each carrying `word`. Returns their ids. */
async function seedSearchable(workspaceId: string, ownerId: string, word: string) {
  const company = await prisma.company.create({
    data: { name: `${word} Holdings`, ownerId, workspaceId },
  });
  const contact = await prisma.contact.create({
    data: { firstName: "Pat", lastName: word, status: "LEAD", companyId: company.id, ownerId, workspaceId },
  });
  const deal = await prisma.deal.create({
    data: {
      title: `${word} renewal`,
      value: 100,
      stage: "LEAD",
      position: 0,
      contactId: contact.id,
      companyId: company.id,
      ownerId,
      workspaceId,
    },
  });
  const activity = await prisma.activity.create({
    data: { type: "NOTE", content: `Met the ${word} team`, contactId: contact.id, userId: ownerId, workspaceId },
  });
  return [company.id, contact.id, deal.id, activity.id];
}

describe("search.ts", () => {
  registerCrossTenantCase("src/server/actions/search.ts#searchRecords");

  it("returns only the caller's workspace when both hold an exact match", async () => {
    await seedSearchable(b.workspaceId, b.owner.id, "Quokka");
    const own = await seedSearchable(a.workspaceId, actor.id, "Quokka");

    const result = await searchRecords("Quokka");

    if (!result.ok) throw new Error(result.message);
    expect(result.hits.map((h) => h.id).sort()).toEqual([...own].sort());
  });

  it("finds nothing when only another workspace has a match", async () => {
    await seedSearchable(b.workspaceId, b.owner.id, "Wombat");

    expect(await searchRecords("Wombat")).toEqual({ ok: true, hits: [], truncated: false });
  });
});
