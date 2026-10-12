/**
 * Record caps (spec §7). The check is a count, then a create, with no
 * transaction around them. Caps apply only in multi mode; single mode
 * (self-host, the public demo) stays unlimited.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  formData,
  makeUser,
  makeWorkspace,
  truncateAll,
  type TestUser,
} from "@/test/action-harness";
import { capMessage, PLAN_LIMITS } from "@/lib/plans";

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

const { createContact } = await import("./contacts");
const { createCompany } = await import("./companies");
const { createDeal } = await import("./deals");

let user: TestUser;
let workspaceId: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  await truncateAll(prisma);
  ({ id: workspaceId } = await makeWorkspace(prisma, { slug: "caps" }));
  user = await makeUser(prisma, { email: "capped@example.com", role: "OWNER", workspaceId });
  currentUser = user;
});
afterEach(() => {
  delete process.env.WORKSPACE_MODE;
});

async function fillContacts(n: number, ws: string = workspaceId, ownerId: string = user.id) {
  await prisma.contact.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      firstName: "Fill",
      lastName: `Contact ${i}`,
      status: "LEAD",
      ownerId,
      workspaceId: ws,
    })),
  });
}

async function fillCompanies(n: number) {
  await prisma.company.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      name: `Fill ${i}`,
      ownerId: user.id,
      workspaceId,
    })),
  });
}

async function fillDeals(n: number) {
  await prisma.deal.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      title: `Fill ${i}`,
      value: 0,
      stage: "LEAD",
      position: i,
      ownerId: user.id,
      workspaceId,
    })),
  });
}

const newContact = () => formData({ firstName: "One", lastName: "More", status: "LEAD" });

describe("contacts", () => {
  it("refuses the next contact at the FREE cap in multi mode, and writes nothing", async () => {
    process.env.WORKSPACE_MODE = "multi";
    await fillContacts(PLAN_LIMITS.FREE.contacts);

    const result = await createContact({}, newContact());

    expect(result.message).toBe(capMessage("contacts", PLAN_LIMITS.FREE.contacts));
    expect(await prisma.contact.count({ where: { workspaceId } })).toBe(PLAN_LIMITS.FREE.contacts);
    expect(await prisma.auditLog.count({ where: { action: "contact.create" } })).toBe(0);
  });

  it("allows the last contact under the cap", async () => {
    process.env.WORKSPACE_MODE = "multi";
    await fillContacts(PLAN_LIMITS.FREE.contacts - 1);

    expect((await createContact({}, newContact())).success).toBe(true);
  });

  it("holds a PAID workspace to the PAID limit", async () => {
    process.env.WORKSPACE_MODE = "multi";
    await prisma.workspace.update({ where: { id: workspaceId }, data: { plan: "PAID" } });
    await fillContacts(PLAN_LIMITS.FREE.contacts);

    expect((await createContact({}, newContact())).success).toBe(true);
  });

  it("counts only the caller's workspace", async () => {
    process.env.WORKSPACE_MODE = "multi";
    const { id: other } = await makeWorkspace(prisma, { slug: "neighbour" });
    const neighbour = await makeUser(prisma, {
      email: "neighbour@example.com",
      role: "OWNER",
      workspaceId: other,
    });
    await fillContacts(PLAN_LIMITS.FREE.contacts, other, neighbour.id);

    expect((await createContact({}, newContact())).success).toBe(true);
  });

  it("does not cap single mode", async () => {
    await fillContacts(PLAN_LIMITS.FREE.contacts);

    expect((await createContact({}, newContact())).success).toBe(true);
  });
});

describe("companies", () => {
  it("refuses the next company at the FREE cap in multi mode, and writes nothing", async () => {
    process.env.WORKSPACE_MODE = "multi";
    await fillCompanies(PLAN_LIMITS.FREE.companies);

    const result = await createCompany({}, formData({ name: "One too many" }));

    expect(result.message).toBe(capMessage("companies", PLAN_LIMITS.FREE.companies));
    expect(await prisma.company.count({ where: { workspaceId } })).toBe(
      PLAN_LIMITS.FREE.companies,
    );
  });

  it("does not cap single mode", async () => {
    await fillCompanies(PLAN_LIMITS.FREE.companies);

    expect((await createCompany({}, formData({ name: "Unlimited" }))).success).toBe(true);
  });
});

describe("deals", () => {
  it("refuses the next deal at the FREE cap in multi mode, counting every stage", async () => {
    process.env.WORKSPACE_MODE = "multi";
    await fillDeals(PLAN_LIMITS.FREE.deals - 1);
    // A closed deal still counts: the cap covers all stages (spec §7).
    await prisma.deal.create({
      data: { title: "Won one", value: 0, stage: "WON", position: 0, ownerId: user.id, workspaceId },
    });

    const result = await createDeal({}, formData({ title: "One too many", value: "100", stage: "LEAD" }));

    expect(result.message).toBe(capMessage("deals", PLAN_LIMITS.FREE.deals));
    expect(await prisma.deal.count({ where: { workspaceId } })).toBe(PLAN_LIMITS.FREE.deals);
  });

  it("does not cap single mode", async () => {
    await fillDeals(PLAN_LIMITS.FREE.deals);

    const result = await createDeal({}, formData({ title: "Unlimited", value: "100", stage: "LEAD" }));

    expect(result.success).toBe(true);
  });
});
