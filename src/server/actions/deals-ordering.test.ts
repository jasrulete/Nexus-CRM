/**
 * Kanban reordering â€” the product's signature interaction, and previously
 * untested at any level.
 *
 * `moveDeal` is the one action that writes rows the caller did not name: it
 * resequences every card in the target column. That makes it the easiest place
 * for an ordering bug to hide, and reorder correctness is the first thing a
 * reviewer probes in a drag-and-drop implementation.
 *
 * These tests also pin a known open defect (see the final block) so that fixing
 * it is a visible change in behaviour rather than a silent one.
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

const { moveDeal, createDeal, updateDeal } = await import("./deals");

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

/** Creates deals in a stage, already correctly sequenced. */
async function seedColumn(stage: string, titles: string[]) {
  const made = [];
  for (const [i, title] of titles.entries()) {
    made.push(
      await prisma.deal.create({
        data: { title, value: 100, stage, position: i, ownerId: owner.id },
      }),
    );
  }
  return made;
}

async function columnOrder(stage: string) {
  const deals = await prisma.deal.findMany({
    where: { stage },
    orderBy: { position: "asc" },
    select: { title: true, position: true },
  });
  return deals.map((d) => d.title);
}

async function positionsIn(stage: string) {
  const deals = await prisma.deal.findMany({
    where: { stage },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  return deals.map((d) => d.position);
}

describe("moveDeal within a single column", () => {
  it("moves a card to the front and resequences the rest", async () => {
    const [, , c] = await seedColumn("LEAD", ["A", "B", "C"]);

    expect(await moveDeal({ dealId: c.id, stage: "LEAD", position: 0 })).toEqual({ ok: true });

    expect(await columnOrder("LEAD")).toEqual(["C", "A", "B"]);
    expect(await positionsIn("LEAD")).toEqual([0, 1, 2]);
  });

  it("moves a card to the middle", async () => {
    const [a] = await seedColumn("LEAD", ["A", "B", "C"]);

    await moveDeal({ dealId: a.id, stage: "LEAD", position: 1 });

    expect(await columnOrder("LEAD")).toEqual(["B", "A", "C"]);
    expect(await positionsIn("LEAD")).toEqual([0, 1, 2]);
  });

  it("clamps a position past the end instead of leaving a gap", async () => {
    const [a] = await seedColumn("LEAD", ["A", "B", "C"]);

    await moveDeal({ dealId: a.id, stage: "LEAD", position: 99 });

    expect(await columnOrder("LEAD")).toEqual(["B", "C", "A"]);
    expect(await positionsIn("LEAD")).toEqual([0, 1, 2]);
  });
});

describe("moveDeal across columns", () => {
  it("inserts into the target column and resequences it", async () => {
    const [a] = await seedColumn("LEAD", ["A", "B"]);
    await seedColumn("PROPOSAL", ["X", "Y"]);

    await moveDeal({ dealId: a.id, stage: "PROPOSAL", position: 1 });

    expect(await columnOrder("PROPOSAL")).toEqual(["X", "A", "Y"]);
    expect(await positionsIn("PROPOSAL")).toEqual([0, 1, 2]);
    expect(await columnOrder("LEAD")).toEqual(["B"]);
  });

  it("stamps closedAt entering a closed stage and clears it on the way back out", async () => {
    const [a] = await seedColumn("NEGOTIATION", ["A"]);

    await moveDeal({ dealId: a.id, stage: "WON", position: 0 });
    const won = await prisma.deal.findUniqueOrThrow({ where: { id: a.id } });
    expect(won.closedAt).not.toBeNull();

    await moveDeal({ dealId: a.id, stage: "NEGOTIATION", position: 0 });
    const reopened = await prisma.deal.findUniqueOrThrow({ where: { id: a.id } });
    expect(reopened.closedAt).toBeNull();
  });

  it("audits a stage change but not a pure reorder", async () => {
    const [a, b] = await seedColumn("LEAD", ["A", "B"]);

    await moveDeal({ dealId: b.id, stage: "LEAD", position: 0 });
    expect(await prisma.auditLog.count({ where: { action: "deal.stage_change" } })).toBe(0);

    await moveDeal({ dealId: a.id, stage: "PROPOSAL", position: 0 });
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "deal.stage_change" },
    });
    expect(entry.metadata).toContain("kanban");
  });

  it("rejects a stage that is not one of the six", async () => {
    const [a] = await seedColumn("LEAD", ["A"]);

    expect(await moveDeal({ dealId: a.id, stage: "PROPOSL", position: 0 })).toEqual({ ok: false });
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: a.id } })).stage).toBe("LEAD");
  });

  it("returns ok:false for a deal that no longer exists", async () => {
    expect(await moveDeal({ dealId: "cuid-that-is-gone", stage: "LEAD", position: 0 })).toEqual({
      ok: false,
    });
  });
});

describe("createDeal positioning", () => {
  it("appends to the end of its stage", async () => {
    await seedColumn("LEAD", ["A", "B"]);

    await createDeal({}, formData({ title: "C", value: "500", stage: "LEAD" }));

    expect(await columnOrder("LEAD")).toEqual(["A", "B", "C"]);
    expect(await positionsIn("LEAD")).toEqual([0, 1, 2]);
  });
});

describe("updateDeal moving a card between columns", () => {
  it("appends the card to the target column instead of keeping its old index", async () => {
    // The defect this replaces: updateDeal wrote stage but never position, so a
    // card edited into another column kept its old index and collided with
    // whatever already sat there. The board sorts purely on position, so the
    // order of the colliding pair was arbitrary and stayed wrong until someone
    // dragged a card and moveDeal resequenced.
    await seedColumn("PROPOSAL", ["X", "Y"]);
    const [, b] = await seedColumn("LEAD", ["A", "B"]); // B is at position 1

    await updateDeal(b.id, {}, formDataFor(b, { title: "B", value: "100", stage: "PROPOSAL" }));

    expect(await positionsIn("PROPOSAL")).toEqual([0, 1, 2]);
    expect(await columnOrder("PROPOSAL")).toEqual(["X", "Y", "B"]);
    expect(new Set(await positionsIn("PROPOSAL")).size).toBe(3);
  });

  it("lands in an empty column at position 0", async () => {
    const [a] = await seedColumn("LEAD", ["A"]);

    await updateDeal(a.id, {}, formDataFor(a, { title: "A", value: "100", stage: "NEGOTIATION" }));

    expect(await positionsIn("NEGOTIATION")).toEqual([0]);
  });

  it("leaves position alone when the stage did not change", async () => {
    // A rename must not shuffle the board.
    const [, b] = await seedColumn("LEAD", ["A", "B"]);

    await updateDeal(b.id, {}, formDataFor(b, { title: "B renamed", value: "100", stage: "LEAD" }));

    expect(await columnOrder("LEAD")).toEqual(["A", "B renamed"]);
    expect(await positionsIn("LEAD")).toEqual([0, 1]);
  });

  it("does not collide with a card that moveDeal later inserts", async () => {
    // The two write paths into a column have to agree on what a position means.
    await seedColumn("PROPOSAL", ["X"]);
    const [a, b] = await seedColumn("LEAD", ["A", "B"]);

    await updateDeal(a.id, {}, formDataFor(a, { title: "A", value: "100", stage: "PROPOSAL" }));
    await moveDeal({ dealId: b.id, stage: "PROPOSAL", position: 1 });

    expect(await columnOrder("PROPOSAL")).toEqual(["X", "B", "A"]);
    expect(await positionsIn("PROPOSAL")).toEqual([0, 1, 2]);
  });
});

describe("concurrent writes keep the column well-formed", () => {
  /** Positions in a column must always be 0..n-1 with no gaps and no repeats. */
  async function expectWellFormed(stage: string) {
    const positions = await positionsIn(stage);
    expect(positions).toEqual(positions.map((_, i) => i));
  }

  it("survives simultaneous creates into the same column", async () => {
    // Both the read of the last position and the insert now happen inside one
    // transaction. Previously they did not, so two creates could read the same
    // last position and both write it.
    await Promise.all(
      ["A", "B", "C", "D", "E"].map((title) =>
        createDeal({}, formData({ title, value: "100", stage: "LEAD" })),
      ),
    );

    expect(await prisma.deal.count({ where: { stage: "LEAD" } })).toBe(5);
    await expectWellFormed("LEAD");
  });

  it("survives simultaneous drags within one column", async () => {
    const [a, b, c] = await seedColumn("LEAD", ["A", "B", "C"]);

    await Promise.all([
      moveDeal({ dealId: c.id, stage: "LEAD", position: 0 }),
      moveDeal({ dealId: a.id, stage: "LEAD", position: 2 }),
      moveDeal({ dealId: b.id, stage: "LEAD", position: 1 }),
    ]);

    // Which order wins is a race and not worth asserting; that the column is
    // still a valid sequence is the invariant that was breaking.
    await expectWellFormed("LEAD");
    expect(await prisma.deal.count({ where: { stage: "LEAD" } })).toBe(3);
  });

  it("survives simultaneous drags into the same column from elsewhere", async () => {
    await seedColumn("PROPOSAL", ["X"]);
    const [a, b] = await seedColumn("LEAD", ["A", "B"]);

    await Promise.all([
      moveDeal({ dealId: a.id, stage: "PROPOSAL", position: 0 }),
      moveDeal({ dealId: b.id, stage: "PROPOSAL", position: 0 }),
    ]);

    await expectWellFormed("PROPOSAL");
    expect(await prisma.deal.count({ where: { stage: "PROPOSAL" } })).toBe(3);
    expect(await prisma.deal.count({ where: { stage: "LEAD" } })).toBe(0);
  });
});
