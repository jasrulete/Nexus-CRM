/**
 * The demo seed is what every reviewer sees first, and it is rebuilt nightly,
 * so what it produces is a product surface rather than test fixtures. It lives
 * in prisma/ but is tested here because vitest collects src/ and the seed runs
 * against the same real-migrations database the action tests use.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeUser, truncateAll, type TestUser } from "@/test/action-harness";
import { seedDemoData } from "../../prisma/seed-data";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let currentUser: TestUser;
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => currentUser,
  getCurrentUser: async () => currentUser,
}));

// No provider: scoreContact takes the same rule-based path the seed must match.
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  return { ...actual, aiProviderName: () => null, generateText: async () => null };
});

const { scoreContact } = await import("./actions/ai");

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});

let userSeq = 0;
beforeEach(async () => {
  await truncateAll(prisma);
  currentUser = await makeUser(prisma, { email: `demo${++userSeq}@example.com`, name: "Demo" });
  await seedDemoData(prisma, currentUser.id);
});

describe("seeded lead scores", () => {
  it("scores most contacts with the rule-based scorer and leaves a few for the demo", async () => {
    const contacts = await prisma.contact.findMany();
    const scored = contacts.filter((c) => c.aiScore !== null);
    const unscored = contacts.filter((c) => c.aiScore === null);

    expect(contacts).toHaveLength(12);
    expect(scored.length).toBeGreaterThanOrEqual(8);
    expect(scored.length).toBeLessThanOrEqual(10);
    for (const c of scored) {
      // The reason is the provenance: a seeded number must read as rule-based,
      // not as a model's live output.
      expect(c.aiScoreReason).toMatch(/^Rule-based score/);
      expect(c.aiScoredAt).not.toBeNull();
    }
    for (const c of unscored) {
      expect(c.aiScoreReason).toBeNull();
      expect(c.aiScoredAt).toBeNull();
    }
  });

  it("seeds exactly the score scoreContact would compute for the same record", async () => {
    const maya = await prisma.contact.findFirstOrThrow({
      where: { email: "maya.okafor@northwind.io" },
    });
    expect(maya.aiScore).not.toBeNull();

    const result = await scoreContact(maya.id);
    expect(result.ok).toBe(true);
    const rescored = await prisma.contact.findUniqueOrThrow({ where: { id: maya.id } });

    expect(rescored.aiScore).toBe(maya.aiScore);
    expect(rescored.aiScoreReason).toBe(maya.aiScoreReason);
  });
});

describe("seeded revenue history", () => {
  // Mirrors the dashboard's bucketing: local calendar months, the current
  // month and the five before it.
  function monthKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  it("lands won revenue in each of the last six months, growing month over month", async () => {
    const won = await prisma.deal.findMany({
      where: { stage: "WON" },
      select: { baseValue: true, closedAt: true },
    });

    const cursor = new Date();
    cursor.setMonth(cursor.getMonth() - 5);
    cursor.setDate(1);
    const series: number[] = [];
    for (let i = 0; i < 6; i++) {
      const key = monthKey(cursor);
      series.push(
        won
          .filter((d) => d.closedAt && monthKey(d.closedAt) === key)
          .reduce((s, d) => s + d.baseValue, 0),
      );
      cursor.setMonth(cursor.getMonth() + 1);
    }

    expect(series.every((v) => v > 0)).toBe(true);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThan(series[i - 1]!);
    }
    // Nothing closed in the future, whatever day of the month the seed runs.
    for (const d of won) expect(d.closedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
