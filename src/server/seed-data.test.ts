/**
 * The demo seed is what every reviewer sees first, and it is rebuilt nightly,
 * so what it produces is a product surface rather than test fixtures. It lives
 * in prisma/ but is tested here because vitest collects src/ and the seed runs
 * against the same real-migrations database the action tests use.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeUser, truncateAll, type TestUser } from "@/test/action-harness";
import { lastSixMonths, monthKey } from "@/lib/months";
import { seedDemoData } from "../../prisma/seed-data";

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

let currentUser: TestUser;
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => currentUser,
  getCurrentUser: async () => currentUser,
  createSession: async () => {},
  destroySession: async () => {},
}));

// No provider: scoreContact takes the same rule-based path the seed must match.
// It asks generateJson, so that is the entry point faked; generateText is faked
// too. Both answer what the real chain says with no key: not_configured, nothing
// spent, nothing billed.
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  const noProvider = {
    ok: false as const,
    reason: "not_configured" as const,
    usage: { inputTokens: 0, outputTokens: 0 },
    billed: false,
  };
  return {
    ...actual,
    aiProviderName: () => null,
    generateText: async () => noProvider,
    generateJson: async () => noProvider,
  };
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
  // Belt and braces with the mock above: a key in the shell must not reach a
  // provider from this file.
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
  await truncateAll(prisma);
  currentUser = await makeUser(prisma, { email: `demo${++userSeq}@example.com`, name: "Demo" });
  await seedDemoData(prisma, currentUser.id);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * scoreContact reads through the workspace-scoped client, and until Task 17
 * seedDemoData doesn't stamp workspaceId, so the seeded rows are moved into
 * the test user's workspace first. Once the seed stamps them itself, every
 * updateMany here matches nothing.
 */
async function adoptSeededRows(workspaceId: string) {
  const where = { workspaceId: null };
  const data = { workspaceId };
  await prisma.company.updateMany({ where, data });
  await prisma.contact.updateMany({ where, data });
  await prisma.deal.updateMany({ where, data });
  await prisma.activity.updateMany({ where, data });
  await prisma.task.updateMany({ where, data });
}

describe("the AI providers", () => {
  // scoreContact asks generateJson, so the provider mock above has to cover it:
  // a key exported in the shell that runs the suite would otherwise send the
  // seeded data to Google or Groq. The keys here are placeholders and fetch is
  // scripted to refuse, so nothing leaves the process even if the mock breaks.
  it("are never reached, even with keys in the environment", async () => {
    vi.stubEnv("GEMINI_API_KEY", "placeholder-gemini-key");
    vi.stubEnv("GROQ_API_KEY", "placeholder-groq-key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no network in this suite"));
    await adoptSeededRows(currentUser.workspaceId);
    const maya = await prisma.contact.findFirstOrThrow({
      where: { email: "maya.okafor@northwind.io" },
    });

    const result = await scoreContact(maya.id);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, provider: "heuristic", degraded: "not_configured" });
  });
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
    await adoptSeededRows(currentUser.workspaceId);
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
  // The same bucketing the dashboard uses — imported, not copied, so this test
  // cannot silently agree with a window the dashboard no longer draws.
  async function wonSeries(): Promise<number[]> {
    const won = await prisma.deal.findMany({
      where: { stage: "WON" },
      select: { baseValue: true, closedAt: true },
    });
    for (const d of won) expect(d.closedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    return lastSixMonths().map((month) =>
      won
        .filter((d) => d.closedAt && monthKey(d.closedAt) === monthKey(month))
        .reduce((s, d) => s + d.baseValue, 0),
    );
  }

  it("lands won revenue in each of the last six months, growing month over month", async () => {
    const series = await wonSeries();
    expect(series.every((v) => v > 0)).toBe(true);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeGreaterThan(series[i - 1]!);
    }
  });

  describe("on July 31", () => {
    // The day the dashboard's old window arithmetic overflowed February.
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 31, 12));
      await truncateAll(prisma);
      currentUser = await makeUser(prisma, { email: `july${++userSeq}@example.com`, name: "July" });
      await seedDemoData(prisma, currentUser.id);
    });
    afterEach(() => vi.useRealTimers());

    it("still fills every bucket the dashboard draws", async () => {
      const series = await wonSeries();
      expect(series.every((v) => v > 0)).toBe(true);
    });
  });
});

describe("seeding into a workspace that already has data", () => {
  it("never touches a contact it did not create", async () => {
    const other = await makeUser(prisma, { email: "resident@example.com", name: "Resident" });
    const theirs = await prisma.contact.create({
      data: {
        firstName: "Rae",
        lastName: "Resident",
        status: "LEAD",
        ownerId: other.id,
        aiScore: 91,
        aiScoreReason: "Strong buying signals across three calls.",
        aiScoredAt: new Date(2026, 7, 1),
      },
    });

    // The seed's scoring pass has to be scoped to the rows it inserted. It
    // used to select every contact except three seeded ids, so a self-hosted
    // instance whose owner registered and scored contacts before running the
    // seed had those model scores replaced with rule-based ones.
    await seedDemoData(prisma, currentUser.id);

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.aiScore).toBe(91);
    expect(after.aiScoreReason).toBe("Strong buying signals across three calls.");
    expect(after.aiScoredAt).toEqual(new Date(2026, 7, 1));
  });
});
