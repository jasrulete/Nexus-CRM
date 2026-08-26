/**
 * Optimistic concurrency on the edit forms.
 *
 * The behaviour being protected: two people open the same record; A saves; B
 * saves from a form rendered before A's change. B used to win silently,
 * reverting every field A had touched, with an audit entry recording only
 * "contact.update" and no diff. B is now refused.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  formData,
  makeUser,
  truncateAll,
  type TestUser,
} from "@/test/action-harness";
import { STALE_RECORD } from "@/lib/concurrency";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

let currentUser: TestUser;
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => currentUser,
  getCurrentUser: async () => currentUser,
}));

const { updateContact } = await import("./contacts");
const { updateCompany } = await import("./companies");
const { updateDeal } = await import("./deals");

let owner: TestUser;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  await truncateAll(prisma);
  owner = await makeUser(prisma, { email: "owner@example.com", name: "Ora Owner" });
  currentUser = owner;
});

const iso = (d: Date) => d.toISOString();

describe("contacts", () => {
  it("accepts a save carrying the current version", async () => {
    const contact = await prisma.contact.create({
      data: { firstName: "Maya", lastName: "Okafor", status: "LEAD", ownerId: owner.id },
    });

    const result = await updateContact(
      contact.id,
      {},
      formData({
        firstName: "Maya",
        lastName: "Okafor",
        status: "QUALIFIED",
        updatedAt: iso(contact.updatedAt),
      }),
    );

    expect(result.success).toBe(true);
  });

  it("refuses a save from a form rendered before someone else's change", async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: "Maya",
        lastName: "Okafor",
        phone: "+63 900 000 0000",
        status: "LEAD",
        ownerId: owner.id,
      },
    });
    // The version B's form was rendered from.
    const staleVersion = iso(contact.updatedAt);

    // A saves first, changing the phone number.
    await new Promise((r) => setTimeout(r, 5)); // ensure a distinct updatedAt
    await prisma.contact.update({
      where: { id: contact.id },
      data: { phone: "+63 917 555 1234" },
    });

    // B submits, still holding the old phone in a hidden field it never touched.
    const result = await updateContact(
      contact.id,
      {},
      formData({
        firstName: "Maya",
        lastName: "Okafor",
        phone: "+63 900 000 0000",
        status: "LEAD",
        notes: "Met at the conference",
        updatedAt: staleVersion,
      }),
    );

    expect(result.message).toBe(STALE_RECORD);
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    // A's change survives, and B's write landed nowhere.
    expect(after.phone).toBe("+63 917 555 1234");
    expect(after.notes).toBeNull();
  });

  it("refuses a submit with no version at all rather than falling back to last-write-wins", async () => {
    const contact = await prisma.contact.create({
      data: { firstName: "Maya", lastName: "Okafor", status: "LEAD", ownerId: owner.id },
    });

    const result = await updateContact(
      contact.id,
      {},
      formData({ firstName: "Hijacked", lastName: "Okafor", status: "LEAD" }),
    );

    expect(result.message).toBe(STALE_RECORD);
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).firstName,
    ).toBe("Maya");
  });

  it("refuses an unparseable version", async () => {
    const contact = await prisma.contact.create({
      data: { firstName: "Maya", lastName: "Okafor", status: "LEAD", ownerId: owner.id },
    });

    const result = await updateContact(
      contact.id,
      {},
      formData({
        firstName: "Hijacked",
        lastName: "Okafor",
        status: "LEAD",
        updatedAt: "yesterday-ish",
      }),
    );

    expect(result.message).toBe(STALE_RECORD);
  });
});

describe("companies", () => {
  it("refuses a stale save and leaves the record untouched", async () => {
    const company = await prisma.company.create({
      data: { name: "Northwind", industry: "Data & BI", ownerId: owner.id },
    });
    const staleVersion = iso(company.updatedAt);

    await new Promise((r) => setTimeout(r, 5));
    await prisma.company.update({
      where: { id: company.id },
      data: { industry: "Analytics" },
    });

    const result = await updateCompany(
      company.id,
      {},
      formData({ name: "Northwind Renamed", industry: "Data & BI", updatedAt: staleVersion }),
    );

    expect(result.message).toBe(STALE_RECORD);
    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after.name).toBe("Northwind");
    expect(after.industry).toBe("Analytics");
  });
});

describe("deals", () => {
  it("refuses a stale save without moving the card", async () => {
    const deal = await prisma.deal.create({
      data: {
        title: "Renewal",
        value: 1000,
        baseValue: 1000,
        stage: "LEAD",
        position: 0,
        ownerId: owner.id,
      },
    });
    const staleVersion = iso(deal.updatedAt);

    await new Promise((r) => setTimeout(r, 5));
    await prisma.deal.update({ where: { id: deal.id }, data: { value: 2000, baseValue: 2000 } });

    const result = await updateDeal(
      deal.id,
      {},
      formData({
        title: "Renewal",
        value: "1000",
        stage: "PROPOSAL",
        currency: "USD",
        updatedAt: staleVersion,
      }),
    );

    expect(result.message).toBe(STALE_RECORD);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    // The conflict check sits inside the same transaction as the repositioning,
    // so a refused save must not have moved the card either.
    expect(after.stage).toBe("LEAD");
    expect(after.position).toBe(0);
    expect(after.value).toBe(2000);
  });

  it("accepts a save carrying the current version", async () => {
    const deal = await prisma.deal.create({
      data: {
        title: "Renewal",
        value: 1000,
        baseValue: 1000,
        stage: "LEAD",
        position: 0,
        ownerId: owner.id,
      },
    });

    const result = await updateDeal(
      deal.id,
      {},
      formData({
        title: "Renewal (updated)",
        value: "1000",
        stage: "PROPOSAL",
        currency: "USD",
        updatedAt: iso(deal.updatedAt),
      }),
    );

    expect(result.success).toBe(true);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(after.title).toBe("Renewal (updated)");
    expect(after.stage).toBe("PROPOSAL");
  });

  it("does not audit a refused save", async () => {
    const deal = await prisma.deal.create({
      data: {
        title: "Renewal",
        value: 1000,
        baseValue: 1000,
        stage: "LEAD",
        position: 0,
        ownerId: owner.id,
      },
    });
    const staleVersion = iso(deal.updatedAt);
    await new Promise((r) => setTimeout(r, 5));
    await prisma.deal.update({ where: { id: deal.id }, data: { title: "Renamed" } });

    await updateDeal(
      deal.id,
      {},
      formData({
        title: "Renewal",
        value: "1000",
        stage: "WON",
        currency: "USD",
        updatedAt: staleVersion,
      }),
    );

    // A stage_change entry for a change that never happened would make the
    // audit log lie.
    expect(await prisma.auditLog.count()).toBe(0);
  });
});
