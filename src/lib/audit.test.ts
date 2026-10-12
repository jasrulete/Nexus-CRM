/**
 * Workspace audit writes, against a real database through the real scoped
 * client. Sentry is faked so a swallowed failure can be seen.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeUser, makeWorkspace, truncateAll } from "@/test/action-harness";
import { TenancyViolation, scopeToWorkspace } from "./tenancy";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
    scopeToWorkspace,
    forWorkspace: (ws: string) => scopeToWorkspace(prisma, ws),
  };
});

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

const { audit, auditTx } = await import("./audit");

afterAll(async () => {
  await destroy();
});

let userId: string;

beforeEach(async () => {
  await truncateAll(prisma);
  await makeWorkspace(prisma, { id: "ws_a" });
  await makeWorkspace(prisma, { id: "ws_b" });
  userId = (await makeUser(prisma, { email: "u@example.com", workspaceId: "ws_a" })).id;
});

afterEach(() => {
  captureException.mockClear();
  vi.restoreAllMocks();
});

const entry = () => ({
  action: "contact.update",
  entityType: "contact",
  entityId: "c1",
  workspaceId: "ws_a",
  userId,
  metadata: { statusFrom: "LEAD", statusTo: "CUSTOMER" },
});

const failingWriter = {
  auditLog: {
    create: async () => {
      throw new Error("database is gone");
    },
  },
};

describe("audit(db, entry)", () => {
  it("writes the entry into the caller's workspace, metadata as JSON", async () => {
    await audit(scopeToWorkspace(prisma, "ws_a"), entry());

    const rows = await prisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "contact.update", workspaceId: "ws_a", userId });
    expect(JSON.parse(rows[0].metadata ?? "")).toEqual({ statusFrom: "LEAD", statusTo: "CUSTOMER" });
  });

  it("normalises a missing userId and metadata to null", async () => {
    await audit(scopeToWorkspace(prisma, "ws_a"), {
      action: "deal.delete",
      entityType: "deal",
      entityId: "d1",
      workspaceId: "ws_a",
    });

    expect(await prisma.auditLog.findFirst()).toMatchObject({ userId: null, metadata: null });
  });

  it("never throws, and reports a swallowed failure to Sentry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(audit(failingWriter, entry())).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, context] = captureException.mock.calls[0];
    expect(context.tags.subsystem).toBe("audit");
    expect(context.extra.action).toBe("contact.update");
  });

  it("cannot land an entry in another workspace: the scoped client refuses it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await audit(scopeToWorkspace(prisma, "ws_a"), { ...entry(), workspaceId: "ws_b" });

    expect(await prisma.auditLog.count()).toBe(0);
    expect(captureException.mock.calls[0][0]).toBeInstanceOf(TenancyViolation);
  });
});

describe("auditTx(tx, entry)", () => {
  it("writes inside the caller's transaction and rolls back with it", async () => {
    const db = scopeToWorkspace(prisma, "ws_a");

    await expect(
      db.$transaction(async (tx) => {
        await auditTx(tx, entry());
        throw new Error("the mutation failed");
      }),
    ).rejects.toThrow("the mutation failed");

    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("commits with the transaction", async () => {
    const db = scopeToWorkspace(prisma, "ws_a");

    await db.$transaction((tx) => auditTx(tx, entry()));

    expect(await prisma.auditLog.count({ where: { workspaceId: "ws_a" } })).toBe(1);
  });

  it("propagates a failure so the caller's transaction rolls back", async () => {
    // The whole point of the transactional form: a state change that committed
    // without its entry would make the log quietly incomplete.
    await expect(auditTx(failingWriter, entry())).rejects.toThrow(/database is gone/);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("propagates the scoped client's refusal of another workspace's entry", async () => {
    await expect(auditTx(scopeToWorkspace(prisma, "ws_a"), { ...entry(), workspaceId: "ws_b" })).rejects.toThrow(
      TenancyViolation,
    );
  });
});
