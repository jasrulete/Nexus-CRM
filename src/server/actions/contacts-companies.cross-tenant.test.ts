/**
 * Contacts and companies across two workspaces (spec §9.1; Review Focus 3).
 *
 * Every export of contacts.ts and companies.ts is called as an ADMIN of
 * workspace A using workspace B's ids. The caller is an admin on purpose:
 * canMutate would let them change any record in A, so the workspace scope is
 * the only thing standing between them and B. Each case asserts "not found" or
 * a dropped link, and that no row of B changed.
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

const { createContact, updateContact, deleteContact } = await import("./contacts");
const { createCompany, updateCompany, deleteCompany } = await import("./companies");

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

describe("contacts.ts", () => {
  registerCrossTenantCase("src/server/actions/contacts.ts#createContact");
  registerCrossTenantCase("src/server/actions/contacts.ts#updateContact");
  registerCrossTenantCase("src/server/actions/contacts.ts#deleteContact");

  it("createContact with B's companyId creates A's contact with no company link", async () => {
    const result = await createContact(
      {},
      formData({ firstName: "Tamp", lastName: "Ered", status: "LEAD", companyId: b.companyId }),
    );

    expect(result.success).toBe(true);
    const created = await prisma.contact.findFirstOrThrow({ where: { lastName: "Ered" } });
    expect(created.workspaceId).toBe(a.workspaceId);
    expect(created.companyId).toBeNull();
    await expectBUnchanged();
  });

  it("createContact ignores a workspaceId smuggled into the form", async () => {
    await createContact(
      {},
      formData({ firstName: "Smug", lastName: "Gled", status: "LEAD", workspaceId: b.workspaceId }),
    );

    const created = await prisma.contact.findFirstOrThrow({ where: { lastName: "Gled" } });
    expect(created.workspaceId).toBe(a.workspaceId);
    await expectBUnchanged();
  });

  it("createContact still links A's own company", async () => {
    await createContact(
      {},
      formData({ firstName: "Own", lastName: "Link", status: "LEAD", companyId: a.companyId }),
    );

    const created = await prisma.contact.findFirstOrThrow({ where: { lastName: "Link" } });
    expect(created.companyId).toBe(a.companyId);
  });

  it("updateContact on B's contact is not found and writes nothing", async () => {
    // B's real version, so a broken scope would pass the stale check and write.
    const target = await prisma.contact.findUniqueOrThrow({ where: { id: b.contactId } });

    const result = await updateContact(
      b.contactId,
      {},
      formDataFor(target, { firstName: "Hijacked", lastName: "Contact", status: "CHURNED" }),
    );

    expect(result.message).toBe("Contact not found");
    await expectBUnchanged();
  });

  it("updateContact on A's own contact drops B's companyId", async () => {
    const own = await prisma.contact.findUniqueOrThrow({ where: { id: a.contactId } });

    const result = await updateContact(
      a.contactId,
      {},
      formDataFor(own, {
        firstName: "Ann",
        lastName: "Own",
        status: "LEAD",
        companyId: b.companyId,
      }),
    );

    expect(result.success).toBe(true);
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: a.contactId } });
    expect(after.companyId).toBeNull();
    await expectBUnchanged();
  });

  it("deleteContact on B's contact is a no-op", async () => {
    await expect(deleteContact(b.contactId)).resolves.toBeUndefined();
    expect(await prisma.contact.count({ where: { id: b.contactId } })).toBe(1);
    await expectBUnchanged();
  });
});

describe("companies.ts", () => {
  registerCrossTenantCase("src/server/actions/companies.ts#createCompany");
  registerCrossTenantCase("src/server/actions/companies.ts#updateCompany");
  registerCrossTenantCase("src/server/actions/companies.ts#deleteCompany");

  it("createCompany lands in A, whatever the form says", async () => {
    const result = await createCompany(
      {},
      formData({ name: "Smuggled Holdings", workspaceId: b.workspaceId }),
    );

    expect(result.success).toBe(true);
    const created = await prisma.company.findFirstOrThrow({ where: { name: "Smuggled Holdings" } });
    expect(created.workspaceId).toBe(a.workspaceId);
    await expectBUnchanged();
  });

  it("updateCompany on B's company is not found and writes nothing", async () => {
    const target = await prisma.company.findUniqueOrThrow({ where: { id: b.companyId } });

    const result = await updateCompany(b.companyId, {}, formDataFor(target, { name: "Hijacked" }));

    expect(result.message).toBe("Company not found");
    await expectBUnchanged();
  });

  it("deleteCompany on B's company is a no-op", async () => {
    await expect(deleteCompany(b.companyId)).resolves.toBeUndefined();
    expect(await prisma.company.count({ where: { id: b.companyId } })).toBe(1);
    await expectBUnchanged();
  });
});

describe("audit rows", () => {
  it("record A's writes in A's workspace", async () => {
    await createContact({}, formData({ firstName: "Aud", lastName: "Ited", status: "LEAD" }));
    await createCompany({}, formData({ name: "Audited Co" }));

    const rows = await prisma.auditLog.findMany({ where: { userId: actor.id } });
    expect(rows.map((r) => r.action).sort()).toEqual(["company.create", "contact.create"]);
    expect(rows.every((r) => r.workspaceId === a.workspaceId)).toBe(true);
  });
});
