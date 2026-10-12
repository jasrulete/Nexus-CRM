/**
 * The AI usage ledger (spec §7), against a real database: the monthly
 * allowance (multi mode only), the deployment-wide daily ceiling (any mode),
 * the pending reservation and the settled row. Only the session lookup is
 * faked; the workspace context, the scoped client and aiCallsToday run for real.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, truncateAll, type TestUser } from "@/test/action-harness";
import type { TenantFixture } from "@/test/cross-tenant";

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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

let currentUser: TestUser;
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => currentUser,
  requireUser: async () => currentUser,
  createSession: async () => {},
  destroySession: async () => {},
}));

const { requireWorkspace } = await import("@/lib/workspace-context");
const { twoWorkspaces } = await import("@/test/cross-tenant");
const { PLAN_LIMITS } = await import("@/lib/plans");
const { reserveAiCall, settleAiCall } = await import("./usage");

const NOW = new Date("2026-10-11T12:00:00.000Z");
const CHARGED = ["pending", "answered", "rejected"];
const DENIED_MESSAGE =
  "This workspace has used its 30 AI actions for this month. They reset on the 1st (UTC), or upgrade for more.";

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  vi.stubEnv("WORKSPACE_MODE", "single");
  vi.stubEnv("AI_DAILY_CEILING", "");
  await truncateAll(prisma);
  ({ a, b } = await twoWorkspaces(prisma));
  currentUser = a.owner;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function addRows(workspaceId: string, outcome: string, n: number, createdAt = NOW) {
  await prisma.aiUsage.createMany({
    data: Array.from({ length: n }, () => ({ workspaceId, action: "summary", outcome, createdAt })),
  });
}

function charged(workspaceId: string) {
  return prisma.aiUsage.count({ where: { workspaceId, outcome: { in: CHARGED } } });
}

const multi = () => vi.stubEnv("WORKSPACE_MODE", "multi");

describe("the plan numbers", () => {
  it("gives FREE 30 AI actions a month and PAID 600", () => {
    expect(PLAN_LIMITS.FREE.aiActionsPerMonth).toBe(30);
    expect(PLAN_LIMITS.PAID.aiActionsPerMonth).toBe(600);
  });
});

describe("reserveAiCall: the monthly allowance", () => {
  it("reserves a pending row before the call, stamped with the workspace and the caller", async () => {
    const ctx = await requireWorkspace();

    const r = await reserveAiCall(ctx, "score", NOW);

    expect(r.kind).toBe("go");
    if (r.kind !== "go") return;
    expect(await prisma.aiUsage.findUniqueOrThrow({ where: { id: r.usageId } })).toMatchObject({
      workspaceId: a.workspaceId,
      userId: a.owner.id,
      action: "score",
      outcome: "pending",
      provider: null,
      inputTokens: null,
      outputTokens: null,
      createdAt: NOW,
    });
  });

  it("has no monthly allowance in single mode", async () => {
    await addRows(a.workspaceId, "answered", PLAN_LIMITS.PAID.aiActionsPerMonth + 5);

    expect((await reserveAiCall(await requireWorkspace(), "summary", NOW)).kind).toBe("go");
  });

  it("denies at the FREE allowance in multi mode, writes a denied row and reserves nothing", async () => {
    multi();
    await addRows(a.workspaceId, "answered", 30);
    const ctx = await requireWorkspace();

    await expect(reserveAiCall(ctx, "draft", NOW)).resolves.toEqual({
      kind: "denied",
      message: DENIED_MESSAGE,
    });
    expect(
      await prisma.aiUsage.count({ where: { workspaceId: a.workspaceId, outcome: "denied", action: "draft" } }),
    ).toBe(1);
    expect(await prisma.aiUsage.count({ where: { outcome: "pending" } })).toBe(0);
  });

  it("charges pending, answered and rejected rows, and nothing else", async () => {
    multi();
    await addRows(a.workspaceId, "pending", 10);
    await addRows(a.workspaceId, "answered", 10);
    await addRows(a.workspaceId, "rejected", 9);
    // An outage, the deployment's ceiling and earlier refusals cost nothing.
    await addRows(a.workspaceId, "fallback", 50);
    await addRows(a.workspaceId, "capacity", 50);
    await addRows(a.workspaceId, "denied", 50);
    const ctx = await requireWorkspace();

    expect((await reserveAiCall(ctx, "summary", NOW)).kind).toBe("go"); // the 30th
    expect((await reserveAiCall(ctx, "summary", NOW)).kind).toBe("denied");
  });

  it("keeps counting a reservation that never settled", async () => {
    multi();
    await addRows(a.workspaceId, "answered", 29);
    const ctx = await requireWorkspace();

    // Reserved and never settled, as when a function is killed mid-call: it
    // stays counted, which fails closed.
    expect((await reserveAiCall(ctx, "summary", NOW)).kind).toBe("go");
    expect((await reserveAiCall(ctx, "summary", NOW)).kind).toBe("denied");
  });

  it("starts a new allowance at 00:00 UTC on the 1st", async () => {
    multi();
    await addRows(a.workspaceId, "answered", 30, new Date("2026-10-31T23:59:59.000Z"));
    const ctx = await requireWorkspace();

    expect((await reserveAiCall(ctx, "summary", new Date("2026-10-31T23:59:59.500Z"))).kind).toBe("denied");
    expect((await reserveAiCall(ctx, "summary", new Date("2026-11-01T00:00:00.000Z"))).kind).toBe("go");
  });

  it("gives a PAID workspace its larger allowance", async () => {
    multi();
    await prisma.workspace.update({ where: { id: a.workspaceId }, data: { plan: "PAID" } });
    await addRows(a.workspaceId, "answered", 30);
    const ctx = await requireWorkspace();
    expect(ctx.plan).toBe("PAID");

    expect((await reserveAiCall(ctx, "summary", NOW)).kind).toBe("go");
    await addRows(a.workspaceId, "answered", 600 - 31);
    expect((await reserveAiCall(ctx, "summary", NOW)).kind).toBe("denied");
  });

  it("counts only the caller's workspace against its allowance", async () => {
    multi();
    await addRows(b.workspaceId, "answered", 30);

    expect((await reserveAiCall(await requireWorkspace(), "summary", NOW)).kind).toBe("go");
  });

  // Review Focus 4, at the ledger: N reservations racing at allowance - 1 can
  // each see one slot left. The overshoot is bounded by the number in flight,
  // and once they've landed the next caller is refused, before any settles.
  it("overshoots by at most the reservations in flight", async () => {
    multi();
    await addRows(a.workspaceId, "answered", 29);
    const ctx = await requireWorkspace();
    const IN_FLIGHT = 6;

    const results = await Promise.all(
      Array.from({ length: IN_FLIGHT }, () => reserveAiCall(ctx, "summary", NOW)),
    );

    const went = results.filter((r) => r.kind === "go").length;
    expect(went).toBeGreaterThanOrEqual(1);
    expect(await charged(a.workspaceId)).toBe(29 + went);
    expect(29 + went - 30).toBeLessThanOrEqual(IN_FLIGHT - 1);
    expect((await reserveAiCall(ctx, "summary", NOW)).kind).toBe("denied");
  });
});

describe("reserveAiCall: the daily ceiling", () => {
  it.each(["single", "multi"])(
    "answers capacity at the ceiling in %s mode, counting every workspace",
    async (mode) => {
      vi.stubEnv("WORKSPACE_MODE", mode);
      vi.stubEnv("AI_DAILY_CEILING", "3");
      await addRows(b.workspaceId, "answered", 3);
      const ctx = await requireWorkspace();

      await expect(reserveAiCall(ctx, "summary", NOW)).resolves.toEqual({ kind: "capacity" });
      expect(
        await prisma.aiUsage.count({ where: { workspaceId: a.workspaceId, outcome: "capacity" } }),
      ).toBe(1);
      // A capacity row is charged neither to the workspace nor to the ceiling.
      expect(await charged(a.workspaceId)).toBe(0);
      await expect(reserveAiCall(ctx, "summary", NOW)).resolves.toEqual({ kind: "capacity" });
    },
  );

  it("counts only today (UTC) against the ceiling", async () => {
    vi.stubEnv("AI_DAILY_CEILING", "3");
    await addRows(b.workspaceId, "answered", 3, new Date("2026-10-10T23:59:59.000Z"));

    expect((await reserveAiCall(await requireWorkspace(), "summary", NOW)).kind).toBe("go");
  });

  it("has no ceiling when AI_DAILY_CEILING is unset", async () => {
    await addRows(b.workspaceId, "answered", 500);

    expect((await reserveAiCall(await requireWorkspace(), "summary", NOW)).kind).toBe("go");
  });

  it("fails closed on a ceiling that is not a whole number", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("AI_DAILY_CEILING", "lots");

    await expect(reserveAiCall(await requireWorkspace(), "summary", NOW)).resolves.toEqual({
      kind: "capacity",
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("AI_DAILY_CEILING"));
  });

  it("checks the allowance before the ceiling", async () => {
    multi();
    vi.stubEnv("AI_DAILY_CEILING", "1");
    await addRows(a.workspaceId, "answered", 30);

    expect((await reserveAiCall(await requireWorkspace(), "summary", NOW)).kind).toBe("denied");
    expect(await prisma.aiUsage.count({ where: { outcome: "capacity" } })).toBe(0);
  });
});

describe("settleAiCall", () => {
  it("records the outcome, the provider and the tokens", async () => {
    const ctx = await requireWorkspace();
    const r = await reserveAiCall(ctx, "draft", NOW);
    if (r.kind !== "go") throw new Error("expected a reservation");

    await settleAiCall(ctx, r.usageId, {
      outcome: "rejected",
      provider: null,
      inputTokens: 1200,
      outputTokens: 180,
    });

    expect(await prisma.aiUsage.findUniqueOrThrow({ where: { id: r.usageId } })).toMatchObject({
      workspaceId: a.workspaceId,
      action: "draft",
      outcome: "rejected",
      provider: null,
      inputTokens: 1200,
      outputTokens: 180,
    });
  });

  it("cannot settle another workspace's row, and does not throw trying", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const foreign = await prisma.aiUsage.create({
      data: { workspaceId: b.workspaceId, action: "summary", outcome: "pending" },
    });
    const ctx = await requireWorkspace();

    await expect(
      settleAiCall(ctx, foreign.id, {
        outcome: "answered",
        provider: "groq/x",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).resolves.toBeUndefined();
    expect(await prisma.aiUsage.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({
      outcome: "pending",
      provider: null,
    });
  });
});
