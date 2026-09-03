/**
 * Multi-currency deals, at the action layer.
 *
 * The property worth protecting: a rate that cannot be fetched must REFUSE the
 * write. Falling back to 1 would store a EUR amount as if it were dollars, and
 * because the rate is frozen onto the row, that corruption is permanent and
 * silent — it would just quietly inflate every total the deal appears in.
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
import { WORKSPACE_CURRENCY } from "@/lib/money";

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

// The rate provider is the one thing genuinely mocked here — the point is to
// drive its failure modes, not to call a third party from a unit test.
const rate = vi.hoisted(() => ({
  next: { ok: true, rate: 1 } as
    | { ok: true; rate: number }
    | { ok: false; reason: "unavailable" },
}));
vi.mock("@/lib/fx", () => ({
  getRateToWorkspaceCurrency: async (from: string) =>
    from === WORKSPACE_CURRENCY ? { ok: true, rate: 1 } : rate.next,
}));

const { createDeal, updateDeal } = await import("./deals");

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
  rate.next = { ok: true, rate: 1 };
});

describe("a deal in the workspace currency", () => {
  it("stores the amount unchanged at a rate of 1", async () => {
    const result = await createDeal(
      {},
      formData({ title: "Domestic", value: "48000", stage: "LEAD", currency: WORKSPACE_CURRENCY }),
    );

    expect(result.success).toBe(true);
    const deal = await prisma.deal.findFirstOrThrow();
    expect(deal.value).toBe(48_000);
    expect(deal.baseValue).toBe(48_000);
    expect(deal.fxRate).toBe(1);
    expect(deal.currency).toBe(WORKSPACE_CURRENCY);
  });
});

describe("a deal in another currency", () => {
  it("freezes the rate and the converted amount onto the row", async () => {
    rate.next = { ok: true, rate: 1.1699 };

    const result = await createDeal(
      {},
      formData({ title: "European", value: "62000", stage: "LEAD", currency: "EUR" }),
    );

    expect(result.success).toBe(true);
    const deal = await prisma.deal.findFirstOrThrow();
    expect(deal.currency).toBe("EUR");
    expect(deal.value).toBe(62_000); // what the user typed, untouched
    expect(deal.fxRate).toBe(1.1699);
    expect(deal.baseValue).toBe(72_534); // 62000 * 1.1699, rounded once
  });

  it("keeps the frozen rate through an edit that does not touch the amount", async () => {
    // The property the whole design rests on, and the one the pre-merge review
    // found broken: updateDeal used to re-resolve the rate on every save, so a
    // title fix months later re-priced a closed deal at that day's rate. A
    // March-closed EUR 62,000 deal moved 72,534 -> 69,186 on a title-only edit.
    rate.next = { ok: true, rate: 1.1699 };
    await createDeal(
      {},
      formData({ title: "European", value: "62000", stage: "LEAD", currency: "EUR" }),
    );
    const before = await prisma.deal.findFirstOrThrow();

    // The euro has moved since. The amount has not.
    rate.next = { ok: true, rate: 1.1159 };
    const result = await updateDeal(
      before.id,
      {},
      formDataFor(before, {
        title: "European (renamed)",
        value: "62000",
        stage: "LEAD",
        currency: "EUR",
      }),
    );

    expect(result.success).toBe(true);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.title).toBe("European (renamed)");
    expect(after.fxRate).toBe(1.1699); // frozen, not today's 1.1159
    expect(after.baseValue).toBe(72_534);
  });

  it("does not need the provider at all for an edit that leaves the amount alone", async () => {
    // Follows from the above: if the rate is carried forward, an unrelated edit
    // must succeed even while the provider is down. Otherwise a Frankfurter
    // outage would block renaming a deal.
    rate.next = { ok: true, rate: 1.1699 };
    await createDeal(
      {},
      formData({ title: "European", value: "62000", stage: "LEAD", currency: "EUR" }),
    );
    const before = await prisma.deal.findFirstOrThrow();

    rate.next = { ok: false, reason: "unavailable" };
    const result = await updateDeal(
      before.id,
      {},
      formDataFor(before, {
        title: "European (renamed)",
        value: "62000",
        stage: "LEAD",
        currency: "EUR",
      }),
    );

    expect(result.success).toBe(true);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.title).toBe("European (renamed)");
    expect(after.baseValue).toBe(72_534);
  });

  it("re-resolves the rate only when the amount or currency actually changes", async () => {
    rate.next = { ok: true, rate: 1.1699 };
    await createDeal(
      {},
      formData({ title: "European", value: "62000", stage: "LEAD", currency: "EUR" }),
    );
    const before = await prisma.deal.findFirstOrThrow();

    rate.next = { ok: true, rate: 1.1159 };
    const result = await updateDeal(
      before.id,
      {},
      formDataFor(before, { title: "European", value: "70000", stage: "LEAD", currency: "EUR" }),
    );

    expect(result.success).toBe(true);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: before.id } });
    // A new amount is a new pricing event, so it gets the current rate.
    expect(after.fxRate).toBe(1.1159);
    expect(after.baseValue).toBe(78_113); // 70000 * 1.1159, rounded
  });

  it("refuses a real amount change when the provider is unreachable, and writes nothing", async () => {
    rate.next = { ok: true, rate: 1.1699 };
    await createDeal(
      {},
      formData({ title: "European", value: "62000", stage: "LEAD", currency: "EUR" }),
    );
    const before = await prisma.deal.findFirstOrThrow();

    rate.next = { ok: false, reason: "unavailable" };
    const result = await updateDeal(
      before.id,
      {},
      formDataFor(before, {
        title: "European (renamed)",
        value: "70000",
        stage: "LEAD",
        currency: "EUR",
      }),
    );

    expect(result.message).toMatch(/exchange rate/i);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: before.id } });
    // Nothing was written — not the title, and certainly not the amount.
    expect(after.title).toBe("European");
    expect(after.value).toBe(62_000);
    expect(after.baseValue).toBe(72_534);
    expect(after.fxRate).toBe(1.1699);
  });
});

describe("when no rate is available", () => {
  it("refuses to create the deal rather than assume a rate of 1", async () => {
    rate.next = { ok: false, reason: "unavailable" };

    const result = await createDeal(
      {},
      formData({ title: "European", value: "62000", stage: "LEAD", currency: "EUR" }),
    );

    expect(result.message).toMatch(/exchange rate/i);
    expect(await prisma.deal.count()).toBe(0);
  });

  it("still allows a deal in the workspace currency, which needs no rate", async () => {
    rate.next = { ok: false, reason: "unavailable" };

    const result = await createDeal(
      {},
      formData({ title: "Domestic", value: "48000", stage: "LEAD", currency: WORKSPACE_CURRENCY }),
    );

    // A provider outage must not stop the single-currency case working.
    expect(result.success).toBe(true);
    expect(await prisma.deal.count()).toBe(1);
  });
});

describe("currency validation", () => {
  it("rejects a code outside the supported list", async () => {
    const result = await createDeal(
      {},
      formData({ title: "Bad", value: "100", stage: "LEAD", currency: "XYZ" }),
    );

    expect(result.errors?.currency).toBeTruthy();
    expect(await prisma.deal.count()).toBe(0);
  });

  it("defaults to the workspace currency when the field is absent", async () => {
    // An older client, or a form that predates the picker.
    const result = await createDeal({}, formData({ title: "Legacy", value: "100", stage: "LEAD" }));

    expect(result.success).toBe(true);
    const deal = await prisma.deal.findFirstOrThrow();
    expect(deal.currency).toBe(WORKSPACE_CURRENCY);
    expect(deal.baseValue).toBe(100);
  });
});
