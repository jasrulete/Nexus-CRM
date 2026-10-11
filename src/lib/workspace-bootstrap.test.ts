/**
 * The single-mode bootstrap against a real database built from the migrations.
 * Every function here also runs inside register()'s transaction, so the
 * transaction case is pinned too.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { M1_DEFAULT_WORKSPACE_ID } from "@/lib/migration-checks";
import { createTestDatabase, truncateAll } from "@/test/action-harness";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_SLUG,
  assertSingleModeDatabase,
  ensureMember,
  ensureSingleWorkspace,
  memberCount,
  toMembershipRole,
} from "./workspace-bootstrap";

const { prisma, destroy } = createTestDatabase();

afterAll(async () => {
  await destroy();
});

beforeEach(async () => {
  // Membership and Workspace are not in truncateAll until Task 6.
  await prisma.membership.deleteMany();
  await truncateAll(prisma);
  await prisma.workspace.deleteMany();
});

let seq = 0;
async function newUser() {
  seq += 1;
  return prisma.user.create({
    data: { email: `user${seq}@example.com`, name: `User ${seq}`, passwordHash: "not-a-real-hash" },
  });
}

describe("DEFAULT_WORKSPACE_ID", () => {
  it("is the id migration M1 backfills every existing row with", () => {
    // M1's SQL hard-codes the literal. Code that names the default workspace
    // by this constant must mean the row M1 created on a migrated install.
    expect(DEFAULT_WORKSPACE_ID).toBe(M1_DEFAULT_WORKSPACE_ID);
  });
});

describe("ensureSingleWorkspace", () => {
  it("creates the default workspace on an empty database", async () => {
    expect(await ensureSingleWorkspace(prisma)).toEqual({ id: DEFAULT_WORKSPACE_ID });

    const all = await prisma.workspace.findMany();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: DEFAULT_WORKSPACE_ID,
      slug: DEFAULT_WORKSPACE_SLUG,
      name: DEFAULT_WORKSPACE_NAME,
      plan: "FREE",
      isDemo: false,
    });
  });

  it("returns the one existing workspace, whatever its id", async () => {
    await prisma.workspace.create({ data: { id: "ws_other", name: "Other", slug: "other" } });

    expect(await ensureSingleWorkspace(prisma)).toEqual({ id: "ws_other" });
    expect(await prisma.workspace.count()).toBe(1);
  });

  it("leaves exactly one workspace when first calls race", async () => {
    const results = await Promise.all([
      ensureSingleWorkspace(prisma),
      ensureSingleWorkspace(prisma),
      ensureSingleWorkspace(prisma),
    ]);

    expect(results).toEqual([
      { id: DEFAULT_WORKSPACE_ID },
      { id: DEFAULT_WORKSPACE_ID },
      { id: DEFAULT_WORKSPACE_ID },
    ]);
    expect(await prisma.workspace.count()).toBe(1);
  });

  it("refuses a database with two workspaces", async () => {
    await prisma.workspace.create({ data: { id: "ws_a", name: "A", slug: "a" } });
    await prisma.workspace.create({ data: { id: "ws_b", name: "B", slug: "b" } });

    await expect(ensureSingleWorkspace(prisma)).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
    expect(await prisma.workspace.count()).toBe(2);
  });

  it("refuses a PAID workspace", async () => {
    await prisma.workspace.create({ data: { id: "ws_paid", name: "Paid", slug: "paid", plan: "PAID" } });

    await expect(ensureSingleWorkspace(prisma)).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
  });

  it("works through an interactive transaction's client", async () => {
    const result = await prisma.$transaction((tx) => ensureSingleWorkspace(tx));

    expect(result).toEqual({ id: DEFAULT_WORKSPACE_ID });
  });
});

describe("assertSingleModeDatabase", () => {
  it("returns null on an empty database and writes nothing", async () => {
    expect(await assertSingleModeDatabase(prisma)).toBeNull();
    expect(await prisma.workspace.count()).toBe(0);
  });
});

describe("ensureMember", () => {
  it("joins a user to the one workspace with the given role", async () => {
    const user = await newUser();

    expect(await ensureMember(prisma, user.id, "OWNER")).toEqual({
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "OWNER",
    });
    expect(await prisma.membership.findUnique({ where: { userId: user.id } })).toMatchObject({
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "OWNER",
    });
  });

  it("keeps an existing role unless asked to set it", async () => {
    const user = await newUser();
    await ensureMember(prisma, user.id, "ADMIN");

    expect(await ensureMember(prisma, user.id, "MEMBER")).toEqual({
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "ADMIN",
    });
    expect(await ensureMember(prisma, user.id, "MEMBER", { setRole: true })).toEqual({
      workspaceId: DEFAULT_WORKSPACE_ID,
      role: "MEMBER",
    });
    expect(await prisma.membership.count()).toBe(1);
  });

  it("leaves one membership when two first requests for the same user race", async () => {
    const user = await newUser();

    await Promise.all([
      ensureMember(prisma, user.id, "MEMBER"),
      ensureMember(prisma, user.id, "MEMBER"),
    ]);

    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
  });

  it("refuses when two workspaces exist and writes no membership", async () => {
    const user = await newUser();
    await prisma.workspace.create({ data: { id: "ws_a", name: "A", slug: "a" } });
    await prisma.workspace.create({ data: { id: "ws_b", name: "B", slug: "b" } });

    await expect(ensureMember(prisma, user.id, "MEMBER")).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
    expect(await prisma.membership.count()).toBe(0);
  });
});

describe("memberCount", () => {
  it("counts the memberships of one workspace", async () => {
    const a = await newUser();
    const b = await newUser();
    expect(await memberCount(prisma, DEFAULT_WORKSPACE_ID)).toBe(0);

    await ensureMember(prisma, a.id, "OWNER");
    await ensureMember(prisma, b.id, "MEMBER");

    expect(await memberCount(prisma, DEFAULT_WORKSPACE_ID)).toBe(2);
    expect(await memberCount(prisma, "ws_elsewhere")).toBe(0);
  });
});

describe("toMembershipRole", () => {
  it("keeps the three real roles and reads anything else as MEMBER", () => {
    expect(toMembershipRole("OWNER")).toBe("OWNER");
    expect(toMembershipRole("ADMIN")).toBe("ADMIN");
    expect(toMembershipRole("MEMBER")).toBe("MEMBER");
    expect(toMembershipRole("admin")).toBe("MEMBER");
    expect(toMembershipRole("")).toBe("MEMBER");
  });
});
