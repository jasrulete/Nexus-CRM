/**
 * system-queries.ts holds every read that crosses workspaces (spec §5.1), and
 * each function has its own cross-tenant test. aiCallsToday is the
 * deployment-wide daily AI ceiling (spec §7). It must count every workspace's
 * calls, count only calls that used a provider, start the day at 00:00 UTC, and
 * hand back nothing but a number.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeWorkspace, truncateAll } from "@/test/action-harness";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
    scopeToWorkspace,
    forWorkspace: (ws: string) => scopeToWorkspace(prisma, ws),
  };
});

const { aiCallsToday, CHARGED_AI_OUTCOMES } = await import("./system-queries");

const NOW = new Date("2026-10-11T15:30:00.000Z");
let wsA: string;
let wsB: string;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  await truncateAll(prisma);
  wsA = (await makeWorkspace(prisma, { slug: "ceiling-a" })).id;
  wsB = (await makeWorkspace(prisma, { slug: "ceiling-b" })).id;
});

async function usage(workspaceId: string, outcome: string, createdAt: Date) {
  await prisma.aiUsage.create({ data: { workspaceId, action: "score", outcome, createdAt } });
}

describe("CHARGED_AI_OUTCOMES", () => {
  it("is exactly the three outcomes that used a provider call", () => {
    expect(CHARGED_AI_OUTCOMES).toEqual(["pending", "answered", "rejected"]);
  });
});

describe("aiCallsToday", () => {
  it("counts charged calls from every workspace", async () => {
    await usage(wsA, "answered", new Date("2026-10-11T01:00:00.000Z"));
    await usage(wsB, "pending", new Date("2026-10-11T09:00:00.000Z"));
    await usage(wsB, "rejected", new Date("2026-10-11T15:29:00.000Z"));

    expect(await aiCallsToday(NOW)).toBe(3);
  });

  it("does not count calls that never reached a provider", async () => {
    for (const outcome of ["fallback", "capacity", "denied"]) {
      await usage(wsA, outcome, new Date("2026-10-11T10:00:00.000Z"));
    }
    await usage(wsB, "answered", new Date("2026-10-11T10:00:00.000Z"));

    expect(await aiCallsToday(NOW)).toBe(1);
  });

  it("starts the day at 00:00 UTC", async () => {
    await usage(wsA, "answered", new Date("2026-10-10T23:59:59.999Z"));
    await usage(wsB, "answered", new Date("2026-10-11T00:00:00.000Z"));

    expect(await aiCallsToday(NOW)).toBe(1);
  });

  it("hands back a bare number, never rows or workspace ids", async () => {
    await usage(wsA, "answered", new Date("2026-10-11T10:00:00.000Z"));

    const result = await aiCallsToday(NOW);

    expect(typeof result).toBe("number");
    expect(result).toBe(1);
  });

  it("defaults to the current time", async () => {
    await usage(wsA, "answered", new Date("2026-10-11T14:30:00.000Z"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      expect(await aiCallsToday()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
