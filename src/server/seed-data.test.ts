/**
 * The demo seed is what every reviewer sees first, and it is rebuilt nightly,
 * so what it produces is a product surface rather than test fixtures. It lives
 * in prisma/ but is tested here because vitest collects src/ and the seed runs
 * against the same real-migrations database the action tests use.
 *
 * Since the tenancy work, every row it writes carries the workspace it was
 * seeded into, and the install-time path (seedInstall) owns the one-workspace
 * rule and the isDemo bit. Both are pinned below.
 */
import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  makeUser,
  makeWorkspace,
  truncateAll,
  type TestUser,
} from "@/test/action-harness";
import { DEMO_EMAIL } from "@/lib/demo-guard";
import { lastSixMonths, monthKey } from "@/lib/months";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workspace-bootstrap";
import {
  DEMO_MEMBER_EMAIL,
  ensureDemoMember,
  ensureDemoUser,
  seedDemoData,
  seedInstall,
} from "../../prisma/seed-data";

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
  getCurrentUser: async () => currentUser,
  requireUser: async () => currentUser,
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
  await seedDemoData(prisma, currentUser.id, currentUser.workspaceId);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
      await seedDemoData(prisma, currentUser.id, currentUser.workspaceId);
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
        workspaceId: currentUser.workspaceId,
        aiScore: 91,
        aiScoreReason: "Strong buying signals across three calls.",
        aiScoredAt: new Date(2026, 7, 1),
      },
    });

    // The seed's scoring pass has to be scoped to the rows it inserted. It
    // used to select every contact except three seeded ids, so a self-hosted
    // instance whose owner registered and scored contacts before running the
    // seed had those model scores replaced with rule-based ones.
    await seedDemoData(prisma, currentUser.id, currentUser.workspaceId);

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.aiScore).toBe(91);
    expect(after.aiScoreReason).toBe("Strong buying signals across three calls.");
    expect(after.aiScoredAt).toEqual(new Date(2026, 7, 1));
  });
});

describe("workspace stamping", () => {
  it("stamps the seeded workspace on every row it writes, the system.seed audit entry included", async () => {
    const ws = currentUser.workspaceId;
    const elsewhere = { OR: [{ workspaceId: null }, { workspaceId: { not: ws } }] };

    expect(
      await Promise.all([
        prisma.company.count(),
        prisma.contact.count(),
        prisma.deal.count(),
        prisma.activity.count(),
        prisma.task.count(),
      ]),
    ).toEqual([6, 12, 14, 10, 7]);
    // The scoped client verifies a create's workspaceId and never stamps it,
    // so a row the seed forgot would sit here with null.
    expect(
      await Promise.all([
        prisma.company.count({ where: elsewhere }),
        prisma.contact.count({ where: elsewhere }),
        prisma.deal.count({ where: elsewhere }),
        prisma.activity.count({ where: elsewhere }),
        prisma.task.count({ where: elsewhere }),
      ]),
    ).toEqual([0, 0, 0, 0, 0]);
    const seedEntry = await prisma.auditLog.findFirstOrThrow({ where: { action: "system.seed" } });
    expect(seedEntry.workspaceId).toBe(ws);
  });
});

describe("ensureDemoUser", () => {
  it("no longer writes the deprecated User.role", async () => {
    const upsert = vi.spyOn(prisma.user, "upsert");

    await ensureDemoUser(prisma);

    expect(upsert).toHaveBeenCalledTimes(1);
    const [args] = upsert.mock.calls[0]!;
    expect(args.create).not.toHaveProperty("role");
    expect(args.update).not.toHaveProperty("role");
  });
});

describe("seedInstall (npm run db:seed, Docker's SEED_DEMO_DATA boot)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it("seeds an empty database into the one default workspace, with an ADMIN demo membership and isDemo off", async () => {
    const result = await seedInstall(prisma, { markDemo: false });

    expect(result).toEqual({
      skipped: false,
      workspaceId: DEFAULT_WORKSPACE_ID,
      markedDemo: false,
      counts: { companies: 6, contacts: 12, deals: 14 },
    });
    const demo = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    expect(await prisma.membership.findUniqueOrThrow({ where: { userId: demo.id } })).toMatchObject({
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "ADMIN",
    });
    // The Settings roster lists memberships, so a seeded user without one
    // would not render there.
    expect(await prisma.user.count({ where: { membership: { is: null } } })).toBe(0);
    expect(await prisma.workspace.findMany({ select: { id: true, isDemo: true } })).toEqual([
      { id: DEFAULT_WORKSPACE_ID, isDemo: false },
    ]);
    expect(
      await prisma.contact.count({ where: { workspaceId: DEFAULT_WORKSPACE_ID, ownerId: demo.id } }),
    ).toBe(12);
  });

  it("marks the workspace as the demo only when asked", async () => {
    await seedInstall(prisma, { markDemo: true });

    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: DEFAULT_WORKSPACE_ID } })).isDemo,
    ).toBe(true);
  });

  it("skips a database that already has the demo account, flag included", async () => {
    await seedInstall(prisma, { markDemo: false });

    expect(await seedInstall(prisma, { markDemo: true })).toEqual({ skipped: true });
    expect(await prisma.contact.count()).toBe(12);
    expect(
      (await prisma.workspace.findUniqueOrThrow({ where: { id: DEFAULT_WORKSPACE_ID } })).isDemo,
    ).toBe(false);
  });

  it("refuses a database with more than one workspace and writes nothing", async () => {
    await makeWorkspace(prisma, { id: "ws_one", slug: "one" });
    await makeWorkspace(prisma, { id: "ws_two", slug: "two" });

    await expect(seedInstall(prisma, { markDemo: false })).rejects.toThrow("SINGLE_MODE_VIOLATION");
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
  });

  it("seeds into a self-hoster's existing workspace instead of creating a second one", async () => {
    const owner = await makeUser(prisma, { email: "owner@selfhost.example", role: "OWNER" });

    const result = await seedInstall(prisma, { markDemo: false });

    expect(result).toMatchObject({ skipped: false, workspaceId: owner.workspaceId });
    expect(await prisma.workspace.count()).toBe(1);
    expect((await prisma.membership.findUniqueOrThrow({ where: { userId: owner.id } })).role).toBe(
      "OWNER",
    );
  });
});

describe("ensureDemoMember (npm run db:add-member)", () => {
  it("creates member@nexuscrm.dev with a MEMBER membership in the one workspace", async () => {
    const { id, workspaceId } = await ensureDemoMember(prisma);

    expect(workspaceId).toBe(currentUser.workspaceId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.email).toBe(DEMO_MEMBER_EMAIL);
    expect(await bcrypt.compare("member-password-123", user.passwordHash)).toBe(true);
    expect((await prisma.membership.findUniqueOrThrow({ where: { userId: id } })).role).toBe("MEMBER");
  });

  it("puts a changed role back to MEMBER on a re-run", async () => {
    const { id } = await ensureDemoMember(prisma);
    await prisma.membership.update({ where: { userId: id }, data: { role: "ADMIN" } });

    await ensureDemoMember(prisma);

    expect((await prisma.membership.findUniqueOrThrow({ where: { userId: id } })).role).toBe("MEMBER");
  });
});
