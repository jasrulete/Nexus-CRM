/**
 * The authorization boundary, tested at the layer that enforces it.
 *
 * SAAS-READINESS §1 records that `toggleTask` once shipped without its
 * ownership check and had to be found by hand; the 2026-08-21 audit found the
 * same class of bug across all four update actions. Nothing pinned either.
 * These tests are the pin: every mutating action is asserted for the owner
 * (allowed), a different member (refused) and an admin (allowed), plus the
 * record is re-read afterwards to prove a refusal actually wrote nothing.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  formData,
  makeUser,
  truncateAll,
  type TestUser,
} from "@/test/action-harness";

const { prisma, destroy } = createTestDatabase();

// Only the four boundaries a unit test cannot cross are faked — see the
// harness header. zod, canMutate, audit and the demo guard all run for real.
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    // Next's redirect() signals by throwing; mirror that so `finally` blocks
    // and error boundaries behave the way they do in the app.
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

let currentUser: TestUser;
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => currentUser,
  getCurrentUser: async () => currentUser,
}));

const { updateContact, deleteContact } = await import("./contacts");
const { updateCompany, deleteCompany } = await import("./companies");
const { updateDeal, deleteDeal, moveDeal } = await import("./deals");
const { toggleTask, deleteTask } = await import("./tasks");
const { deleteActivity } = await import("./activities");

let owner: TestUser;
let stranger: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await destroy();
});

beforeEach(async () => {
  await truncateAll(prisma);
  owner = await makeUser(prisma, { email: "owner@example.com", name: "Ora Owner" });
  stranger = await makeUser(prisma, { email: "stranger@example.com", name: "Stan Stranger" });
  admin = await makeUser(prisma, { email: "admin@example.com", name: "Ada Admin", role: "ADMIN" });
  currentUser = owner;
});

afterEach(() => {
  delete process.env.DEMO_MODE;
});

const NOT_YOURS = "You can only edit records you own.";

async function seedContact() {
  return prisma.contact.create({
    data: { firstName: "Maya", lastName: "Okafor", status: "LEAD", ownerId: owner.id },
  });
}
async function seedCompany() {
  return prisma.company.create({ data: { name: "Northwind", ownerId: owner.id } });
}
async function seedDeal(stage = "LEAD", position = 0) {
  return prisma.deal.create({
    data: { title: "Renewal", value: 1000, stage, position, ownerId: owner.id },
  });
}

// ---------------------------------------------------------------- updates

describe("update actions refuse a member who does not own the record", () => {
  it("updateContact", async () => {
    const contact = await seedContact();
    currentUser = stranger;

    const result = await updateContact(
      contact.id,
      {},
      formData({ firstName: "Hijacked", lastName: "Okafor", status: "LEAD" }),
    );

    expect(result.message).toBe(NOT_YOURS);
    // The refusal must not have written anything.
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.firstName).toBe("Maya");
  });

  it("updateCompany", async () => {
    const company = await seedCompany();
    currentUser = stranger;

    const result = await updateCompany(company.id, {}, formData({ name: "Hijacked" }));

    expect(result.message).toBe(NOT_YOURS);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).name).toBe(
      "Northwind",
    );
  });

  it("updateDeal", async () => {
    const deal = await seedDeal();
    currentUser = stranger;

    const result = await updateDeal(
      deal.id,
      {},
      formData({ title: "Hijacked", value: "999999", stage: "WON" }),
    );

    expect(result.message).toBe(NOT_YOURS);
    // The sharpest case: stage and value feed the dashboard's win rate and
    // revenue chart, which aggregate across every owner.
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(after.stage).toBe("LEAD");
    expect(after.value).toBe(1000);
    expect(after.closedAt).toBeNull();
  });

  it("moveDeal", async () => {
    const deal = await seedDeal();
    currentUser = stranger;

    const result = await moveDeal({ dealId: deal.id, stage: "WON", position: 0 });

    expect(result.ok).toBe(false);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(after.stage).toBe("LEAD");
  });
});

describe("update actions allow the owner and an admin", () => {
  it("owner can update their own contact", async () => {
    const contact = await seedContact();

    const result = await updateContact(
      contact.id,
      {},
      formData({
        firstName: "Maya",
        lastName: "Okafor-Reyes",
        status: "QUALIFIED",
        updatedAt: contact.updatedAt.toISOString(),
      }),
    );

    expect(result.success).toBe(true);
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.lastName).toBe("Okafor-Reyes");
    expect(after.status).toBe("QUALIFIED");
  });

  it("an admin can update a record they do not own", async () => {
    const contact = await seedContact();
    currentUser = admin;

    const result = await updateContact(
      contact.id,
      {},
      formData({
        firstName: "Maya",
        lastName: "Corrected",
        status: "LEAD",
        updatedAt: contact.updatedAt.toISOString(),
      }),
    );

    expect(result.success).toBe(true);
  });

  it("owner can move their own deal, and closedAt is stamped on a won stage", async () => {
    const deal = await seedDeal();

    expect(await moveDeal({ dealId: deal.id, stage: "WON", position: 0 })).toEqual({ ok: true });
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(after.stage).toBe("WON");
    expect(after.closedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------- deletes

describe("delete actions refuse a member who does not own the record", () => {
  it("deleteContact", async () => {
    const contact = await seedContact();
    currentUser = stranger;

    await expect(deleteContact(contact.id)).rejects.toThrow(/FORBIDDEN/);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("deleteCompany", async () => {
    const company = await seedCompany();
    currentUser = stranger;

    await expect(deleteCompany(company.id)).rejects.toThrow(/FORBIDDEN/);
    expect(await prisma.company.count()).toBe(1);
  });

  it("deleteDeal", async () => {
    const deal = await seedDeal();
    currentUser = stranger;

    await expect(deleteDeal(deal.id)).rejects.toThrow(/FORBIDDEN/);
    expect(await prisma.deal.count()).toBe(1);
  });

  it("toggleTask and deleteTask are keyed on the assignee", async () => {
    const task = await prisma.task.create({
      data: { title: "Call Maya", assigneeId: owner.id },
    });
    currentUser = stranger;

    await expect(toggleTask(task.id)).rejects.toThrow(/FORBIDDEN/);
    await expect(deleteTask(task.id)).rejects.toThrow(/FORBIDDEN/);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.done).toBe(false);
  });

  it("deleteActivity is keyed on the author", async () => {
    const contact = await seedContact();
    const activity = await prisma.activity.create({
      data: { type: "NOTE", content: "Left a voicemail", contactId: contact.id, userId: owner.id },
    });
    currentUser = stranger;

    await expect(deleteActivity(activity.id)).rejects.toThrow(/FORBIDDEN/);
    expect(await prisma.activity.count()).toBe(1);
  });
});

describe("delete actions allow the owner and an admin", () => {
  it("the owner can delete their own contact", async () => {
    const contact = await seedContact();

    // deleteContact ends in redirect(), which Next signals by throwing.
    await expect(deleteContact(contact.id)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.contact.count()).toBe(0);
  });

  it("an admin can delete a deal they do not own", async () => {
    const deal = await seedDeal();
    currentUser = admin;

    await deleteDeal(deal.id);
    expect(await prisma.deal.count()).toBe(0);
  });
});

// ---------------------------------------------------------------- demo guard

describe("the demo lock outranks ownership", () => {
  it("blocks the published demo account from deleting its own record", async () => {
    process.env.DEMO_MODE = "true";
    const demo = await makeUser(prisma, {
      email: "demo@nexuscrm.dev",
      name: "Demo User",
      role: "ADMIN",
    });
    const deal = await prisma.deal.create({
      data: { title: "Demo deal", value: 10, stage: "LEAD", position: 0, ownerId: demo.id },
    });
    currentUser = demo;

    // Owner *and* admin, and still refused — the guard runs before both.
    await expect(deleteDeal(deal.id)).rejects.toThrow(/DEMO_READONLY/);
    expect(await prisma.deal.count()).toBe(1);
  });

  it("does not block that account on a private install", async () => {
    delete process.env.DEMO_MODE;
    const demo = await makeUser(prisma, {
      email: "demo@nexuscrm.dev",
      name: "Demo User",
      role: "ADMIN",
    });
    const deal = await prisma.deal.create({
      data: { title: "Demo deal", value: 10, stage: "LEAD", position: 0, ownerId: demo.id },
    });
    currentUser = demo;

    await deleteDeal(deal.id);
    expect(await prisma.deal.count()).toBe(0);
  });
});

// ---------------------------------------------------------------- audit trail

describe("mutations are audited", () => {
  it("records an audit row naming the actor for an allowed update", async () => {
    const contact = await seedContact();

    await updateContact(
      contact.id,
      {},
      formData({
        firstName: "Maya",
        lastName: "Okafor",
        status: "CUSTOMER",
        updatedAt: contact.updatedAt.toISOString(),
      }),
    );

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "contact", entityId: contact.id },
    });
    expect(entry.action).toBe("contact.update");
    expect(entry.userId).toBe(owner.id);
    expect(entry.metadata).toContain("CUSTOMER");
  });

  it("writes nothing when the mutation was refused", async () => {
    const contact = await seedContact();
    currentUser = stranger;

    await updateContact(contact.id, {}, formData({ firstName: "X", lastName: "Y", status: "LEAD" }));

    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe("a delete and its audit entry commit together", () => {
  it("rolls the delete back if the audit write fails", async () => {
    const contact = await seedContact();

    // Break the audit insert at the database, not with a spy: the action writes
    // through the transaction client, so mocking the global one would miss it
    // entirely, and a test that cannot fail is worse than no test.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_audit BEFORE INSERT ON "AuditLog"
       BEGIN SELECT RAISE(ABORT, 'audit write refused'); END;`,
    );

    try {
      // Prisma wraps the SQLite abort, so match the operation it names rather
      // than the trigger's own message — it still proves the failure came from
      // the audit write and not from the delete.
      await expect(deleteContact(contact.id)).rejects.toThrow(/auditLog\.create/);
    } finally {
      // Dropped in a finally: leaking the trigger would break every later test
      // in this file, and the failure would look unrelated.
      await prisma.$executeRawUnsafe(`DROP TRIGGER fail_audit;`);
    }

    // The row survives. A delete that committed without its entry would leave
    // the audit log silently incomplete, and after a delete that entry is the
    // only evidence the row ever existed.
    expect(await prisma.contact.count()).toBe(1);
  });

  it("writes both when the audit succeeds", async () => {
    const contact = await seedContact();

    await expect(deleteContact(contact.id)).rejects.toThrow(/NEXT_REDIRECT/);

    expect(await prisma.contact.count()).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: "contact.delete" } }),
    ).toBe(1);
  });
});
