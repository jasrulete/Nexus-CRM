/**
 * Global search, against a real migrations-built SQLite. Only the database
 * handle, the session and Next's cache are faked (the harness contract); zod,
 * the rate limiter and Prisma's LIKE semantics run for real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeUser, truncateAll, type TestUser } from "@/test/action-harness";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let currentUser: TestUser | null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!currentUser) throw new Error("UNAUTHORIZED");
    return currentUser;
  },
  getCurrentUser: async () => currentUser,
}));

const { searchRecords } = await import("./search");

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});

let owner: TestUser;
let userSeq = 0;
let ids: { maya: string; james: string; northwind: string; deal: string };

beforeEach(async () => {
  await truncateAll(prisma);
  // A distinct user per test: the rate limiter keys on user id in module state.
  owner = await makeUser(prisma, { email: `owner${++userSeq}@example.com`, name: "Ora Owner" });
  currentUser = owner;

  const northwind = await prisma.company.create({
    data: {
      name: "Northwind Analytics",
      domain: "northwind.io",
      industry: "Data & BI",
      notes: "Security questionnaire outstanding.",
      ownerId: owner.id,
    },
  });
  const maya = await prisma.contact.create({
    data: {
      firstName: "Maya",
      lastName: "Okafor",
      email: "maya@northwind.io",
      title: "VP of Data",
      status: "QUALIFIED",
      notes: "Budget approved for Q3.",
      companyId: northwind.id,
      ownerId: owner.id,
    },
  });
  const james = await prisma.contact.create({
    data: {
      firstName: "James",
      lastName: "Whitfield",
      email: "j.whitfield@northwind.io",
      status: "LEAD",
      companyId: northwind.id,
      ownerId: owner.id,
    },
  });
  const deal = await prisma.deal.create({
    data: {
      title: "Northwind — Analytics platform",
      value: 9600,
      currency: "EUR",
      fxRate: 1.1699,
      baseValue: 11231,
      stage: "PROPOSAL",
      position: 0,
      contactId: maya.id,
      companyId: northwind.id,
      ownerId: owner.id,
    },
  });
  await prisma.activity.createMany({
    data: [
      { type: "NOTE", content: "Procurement window opens next quarter.", contactId: maya.id, userId: owner.id },
      { type: "EMAIL", content: "Sent the SSO addendum.", contactId: maya.id, dealId: deal.id, userId: owner.id },
      { type: "NOTE", content: "Security questionnaire returned.", companyId: northwind.id, userId: owner.id },
    ],
  });
  ids = { maya: maya.id, james: james.id, northwind: northwind.id, deal: deal.id };
});

async function hits(q: string) {
  const result = await searchRecords(q);
  if (!result.ok) throw new Error(`search failed: ${result.message}`);
  return result;
}

describe("what it finds", () => {
  it("finds a contact by last name and links to its page", async () => {
    const { hits: found } = await hits("okafor");
    const contact = found.filter((h) => h.kind === "contact");
    expect(contact).toHaveLength(1);
    expect(contact[0]).toMatchObject({ id: ids.maya, href: `/contacts/${ids.maya}`, title: "Maya Okafor" });
    expect(contact[0]!.subtitle).toContain("VP of Data");
    expect(contact[0]!.subtitle).toContain("Northwind");
  });

  it("matches a full name typed with a space, first name first", async () => {
    expect((await hits("Maya Okafor")).hits.some((h) => h.id === ids.maya)).toBe(true);
    // The split heuristic is first-token/rest; the reverse falls back to the
    // per-column OR, which "Okafor Maya" does not satisfy. Documented, not hidden.
    expect((await hits("Okafor Maya")).hits.some((h) => h.kind === "contact")).toBe(false);
  });

  it("searches contact notes and company notes", async () => {
    expect((await hits("Budget approved")).hits.some((h) => h.id === ids.maya)).toBe(true);
    expect((await hits("questionnaire outstanding")).hits.some((h) => h.id === ids.northwind)).toBe(true);
  });

  it("finds companies by name, domain or industry", async () => {
    for (const q of ["northwind.io", "Data & BI", "Northwind Analytics"]) {
      const company = (await hits(q)).hits.find((h) => h.kind === "company");
      expect(company).toMatchObject({ id: ids.northwind, href: `/companies/${ids.northwind}` });
    }
  });

  it("finds a deal by title with stage and converted amount in the subtitle", async () => {
    const deal = (await hits("Analytics platform")).hits.find((h) => h.kind === "deal");
    expect(deal).toMatchObject({ href: `/deals/${ids.deal}`, title: "Northwind — Analytics platform" });
    expect(deal!.subtitle).toContain("Proposal");
    expect(deal!.subtitle).toContain("$11,231 (EUR 9,600)");
  });

  it("finds a note by its content and links it to the record it belongs to", async () => {
    const note = (await hits("procurement")).hits.find((h) => h.kind === "activity");
    expect(note).toMatchObject({ href: `/contacts/${ids.maya}`, title: "Note on Maya Okafor" });
    expect(note!.subtitle).toMatch(/procurement/i);

    const companyNote = (await hits("questionnaire returned")).hits.find((h) => h.kind === "activity");
    expect(companyNote!.href).toBe(`/companies/${ids.northwind}`);
  });

  it("an activity on both a contact and a deal opens the deal", async () => {
    const email = (await hits("SSO addendum")).hits.find((h) => h.kind === "activity");
    expect(email!.href).toBe(`/deals/${ids.deal}`);
    expect(email!.title).toBe("Email on Northwind — Analytics platform");
  });

  it("is case-insensitive for ASCII", async () => {
    const idsFor = async (q: string) => (await hits(q)).hits.map((h) => h.id).sort();
    expect(await idsFor("NORTHWIND")).toEqual(await idsFor("northwind"));
    expect((await idsFor("northwind")).length).toBeGreaterThan(0);
  });

  it("returns records the session user does not own", async () => {
    // Reads are workspace-wide by design (DATA-MODEL: ownership is
    // authorization for mutation, not scoping).
    currentUser = await makeUser(prisma, { email: `member${userSeq}@example.com`, name: "Mel Member" });
    expect((await hits("okafor")).hits.some((h) => h.id === ids.maya)).toBe(true);
  });
});

describe("shape and order", () => {
  it("groups hits contacts, companies, deals, notes in that order", async () => {
    const order = ["contact", "company", "deal", "activity"];
    const kinds = (await hits("Northwind")).hits.map((h) => order.indexOf(h.kind));
    expect(kinds.length).toBeGreaterThan(2);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).toBeGreaterThanOrEqual(kinds[i - 1]!);
  });

  it("orders a group by most recently updated", async () => {
    await prisma.contact.update({
      where: { id: ids.james },
      data: { updatedAt: new Date(Date.now() + 60_000) },
    });
    const contacts = (await hits("northwind.io")).hits.filter((h) => h.kind === "contact");
    expect(contacts.map((h) => h.id)).toEqual([ids.james, ids.maya]);
  });

  it("never serialises more than the hit shape", async () => {
    for (const hit of (await hits("Northwind")).hits) {
      expect(Object.keys(hit).sort()).toEqual(["href", "id", "kind", "subtitle", "title"]);
    }
  });

  it("caps each type at five and reports it exactly", async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.contact.create({
        data: { firstName: "Cap", lastName: `Tester ${i}`, status: "LEAD", ownerId: owner.id },
      });
    }
    const six = await hits("Cap Tester");
    expect(six.hits.filter((h) => h.kind === "contact")).toHaveLength(5);
    expect(six.truncated).toBe(true);

    await prisma.contact.deleteMany({ where: { lastName: "Tester 5" } });
    const five = await hits("Cap Tester");
    expect(five.hits.filter((h) => h.kind === "contact")).toHaveLength(5);
    // Exactly five is not "more than five": the take+1 rule, not length === 5.
    expect(five.truncated).toBe(false);
  });

  it("passes LIKE wildcards through, bounded by the cap", async () => {
    // Prisma's SQLite `contains` is LIKE '%q%' with no ESCAPE, so % and _ act
    // as wildcards. Pinned so a future change to escape them is deliberate.
    // (Two characters, because the minimum length is checked first.)
    const all = await hits("%%");
    expect(all.hits.length).toBeGreaterThan(0);
    expect(all.hits.length).toBeLessThanOrEqual(20);
  });
});

describe("guards", () => {
  it("refuses a query under 2 or over 100 characters without touching the database", async () => {
    const spy = vi.spyOn(prisma.contact, "findMany");
    expect(await searchRecords(" a ")).toMatchObject({ ok: false, message: expect.stringMatching(/at least 2/) });
    expect(await searchRecords("x".repeat(101))).toMatchObject({ ok: false });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rate-limits a runaway caller per user and not their neighbour", async () => {
    for (let i = 0; i < 120; i++) expect((await searchRecords("zz")).ok).toBe(true);
    expect(await searchRecords("zz")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/too many searches/i),
    });
    currentUser = await makeUser(prisma, { email: `neighbour${userSeq}@example.com`, name: "Nia" });
    expect((await searchRecords("zz")).ok).toBe(true);
  });

  it("requires a session", async () => {
    currentUser = null;
    await expect(searchRecords("okafor")).rejects.toThrow("UNAUTHORIZED");
  });
});
