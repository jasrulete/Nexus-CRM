import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, makeWorkspace, truncateAll } from "@/test/action-harness";
import { scopeToWorkspace } from "@/lib/tenancy";

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

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

const { auditPlatform } = await import("./platform-audit");

afterAll(async () => {
  await destroy();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

afterEach(() => {
  captureException.mockClear();
  vi.restoreAllMocks();
});

describe("auditPlatform", () => {
  it("writes an auth event with no workspace", async () => {
    await auditPlatform({
      action: "auth.login_failed",
      entityType: "user",
      entityId: "a@b.c",
      metadata: { ip: "10.0.0.1" },
    });

    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row).toMatchObject({ action: "auth.login_failed", entityId: "a@b.c", userId: null, workspaceId: null });
    expect(JSON.parse(row.metadata ?? "")).toEqual({ ip: "10.0.0.1" });
  });

  it("is never shown to a workspace: the scoped client's filter excludes it", async () => {
    await makeWorkspace(prisma, { id: "ws_a" });
    await auditPlatform({ action: "auth.login_failed", entityType: "user", entityId: "a@b.c", metadata: { ip: "10.0.0.1" } });

    expect(await scopeToWorkspace(prisma, "ws_a").auditLog.findMany()).toEqual([]);
  });

  it("refuses an event outside auth.* and writes nothing", async () => {
    const workspaceEvent = { action: "contact.create", entityType: "contact", entityId: "c1" };

    await expect(auditPlatform(workspaceEvent as unknown as Parameters<typeof auditPlatform>[0])).rejects.toThrow(
      TypeError,
    );
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("never throws on a failed write, and reports it to Sentry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.auditLog, "create").mockRejectedValueOnce(new Error("database is gone"));

    await expect(
      auditPlatform({ action: "auth.logout", entityType: "user", entityId: "u1" }),
    ).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].extra.action).toBe("auth.logout");
  });
});
