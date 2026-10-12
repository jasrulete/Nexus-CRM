/**
 * The single-mode bootstrap against a real database built from the migrations.
 * Every function here also runs inside register()'s transaction, so the
 * transaction case is pinned too.
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { M1_DEFAULT_WORKSPACE_ID } from "@/lib/migration-checks";
import { createTestDatabase, truncateAll } from "@/test/action-harness";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_SLUG,
  assertSingleModeDatabase,
  bootCheckSingleModeDatabase,
  ensureMember,
  ensureSingleWorkspace,
  memberCount,
  toMembershipRole,
} from "./workspace-bootstrap";

const { prisma, file, destroy } = createTestDatabase();
// The schema as it stood before M1: no Workspace table at all.
const preM1 = createTestDatabase({ through: "20260823151943_add_deal_base_value_and_fx_rate" });

afterAll(async () => {
  await destroy();
  await preM1.destroy();
});

beforeEach(async () => {
  await truncateAll(prisma);
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

  it("returns the existing default workspace and creates no other", async () => {
    await prisma.workspace.create({ data: { id: DEFAULT_WORKSPACE_ID, name: "Renamed", slug: "renamed" } });

    expect(await ensureSingleWorkspace(prisma)).toEqual({ id: DEFAULT_WORKSPACE_ID });
    expect(await prisma.workspace.count()).toBe(1);
  });

  // A multi-mode sign-up's workspace has a cuid id. A single-mode deployment
  // pointed at that database must not join strangers to it.
  it("refuses a lone FREE workspace that single mode did not create", async () => {
    const lone = await prisma.workspace.create({ data: { name: "Alice's workspace", slug: "alice-1a2b3c4d" } });
    expect(lone).toMatchObject({ plan: "FREE" });
    expect(lone.id).not.toBe(DEFAULT_WORKSPACE_ID);

    await expect(ensureSingleWorkspace(prisma)).rejects.toThrow(
      /^SINGLE_MODE_VIOLATION: .*its only workspace was not created by single mode/,
    );
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

  it("refuses a lone workspace that single mode did not create and writes no membership", async () => {
    const user = await newUser();
    await prisma.workspace.create({ data: { name: "Alice's workspace", slug: "alice-1a2b3c4d" } });

    await expect(ensureMember(prisma, user.id, "MEMBER")).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
    expect(await prisma.membership.count()).toBe(0);
  });

  it("refuses when two workspaces exist and writes no membership", async () => {
    const user = await newUser();
    await prisma.workspace.create({ data: { id: "ws_a", name: "A", slug: "a" } });
    await prisma.workspace.create({ data: { id: "ws_b", name: "B", slug: "b" } });

    await expect(ensureMember(prisma, user.id, "MEMBER")).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
    expect(await prisma.membership.count()).toBe(0);
  });
});

describe("the upserts are single statements", () => {
  // A no-op `update: {}` makes Prisma emit SELECT, INSERT, SELECT instead of
  // `INSERT ... ON CONFLICT`, and on Turso the loser of a cross-instance race
  // then fails on the unique key. The in-process race tests above cannot tell
  // the two apart (the adapter serialises the calls), so read the SQL.
  it("compiles ensureSingleWorkspace and ensureMember to one INSERT ... ON CONFLICT each", async () => {
    const queries: string[] = [];
    const logged = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: `file:${file}` }),
      log: [{ emit: "event", level: "query" }],
    });
    logged.$on("query", (event) => {
      queries.push(event.query);
    });
    try {
      const user = await newUser();

      await ensureMember(logged, user.id, "MEMBER");

      // One read (the single-mode check), then exactly the two upserts.
      expect(queries.filter((q) => q.startsWith("SELECT"))).toHaveLength(1);
      const writes = queries.filter((q) => !q.startsWith("SELECT"));
      expect(writes).toHaveLength(2);
      expect(writes[0]).toMatch(/^INSERT INTO `main`\.`Workspace`.* ON CONFLICT/);
      expect(writes[1]).toMatch(/^INSERT INTO `main`\.`Membership`.* ON CONFLICT/);
    } finally {
      await logged.$disconnect();
    }
  });

  it("leaves an existing membership untouched, role and creation time", async () => {
    const user = await newUser();
    await ensureMember(prisma, user.id, "ADMIN");
    const before = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });

    await ensureMember(prisma, user.id, "MEMBER");

    expect(await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } })).toEqual(before);
  });
});

describe("bootCheckSingleModeDatabase", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes on an empty database and on one valid workspace, writing nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(bootCheckSingleModeDatabase(prisma)).resolves.toBeUndefined();
    await prisma.workspace.create({ data: { id: DEFAULT_WORKSPACE_ID, name: "One", slug: "one" } });
    await expect(bootCheckSingleModeDatabase(prisma)).resolves.toBeUndefined();

    expect(await prisma.workspace.count()).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("rethrows a SINGLE_MODE_VIOLATION, for two workspaces and for a PAID one", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await prisma.workspace.create({ data: { id: "ws_paid", name: "Paid", slug: "paid", plan: "PAID" } });
    await expect(bootCheckSingleModeDatabase(prisma)).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);

    await prisma.workspace.create({ data: { id: "ws_b", name: "B", slug: "b" } });
    await expect(bootCheckSingleModeDatabase(prisma)).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);

    expect(log).not.toHaveBeenCalled();
  });

  it("rethrows a SINGLE_MODE_VIOLATION for a lone FREE workspace with a cuid id", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await prisma.workspace.create({ data: { name: "Alice's workspace", slug: "alice-1a2b3c4d" } });

    await expect(bootCheckSingleModeDatabase(prisma)).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
    expect(log).not.toHaveBeenCalled();
  });

  it("rethrows a missing table (P2021) with a hint to apply the migrations", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const failure = await bootCheckSingleModeDatabase(preM1.prisma).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("apply the database migrations (M1) before starting");
    expect(((failure as Error).cause as { code?: string }).code).toBe("P2021");
    expect(log).not.toHaveBeenCalled();
  });

  // The libSQL driver is what production (Turso) runs. It reports the same
  // situation as P2039 "Database error" with kind "sqlite", not P2021, because
  // LibsqlError prefixes the message with its code and the adapter's own
  // "no such table" test is a startsWith. An empty in-memory libSQL database has
  // no Workspace table, so this is the real error with no file handle to clean up.
  it("rethrows a missing table as the libSQL driver reports it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const libsql = new PrismaClient({ adapter: new PrismaLibSql({ url: ":memory:" }) });

    try {
      const failure = await bootCheckSingleModeDatabase(libsql).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("apply the database migrations (M1) before starting");
      expect(((failure as Error).cause as { code?: string }).code).toBe("P2039");
    } finally {
      await libsql.$disconnect();
    }
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    [
      "in the message only",
      { message: "Database error. Code: `1`. Message: `SQLITE_ERROR: no such table: main.Workspace`" },
    ],
    [
      "in the driver adapter's originalMessage only",
      {
        message: "Database error.",
        meta: { driverAdapterError: { cause: { originalMessage: "SQLITE_ERROR: no such table: Workspace" } } },
      },
    ],
    [
      "in a nested cause, as a remote LibsqlError carries it",
      {
        message: "Database error.",
        cause: { code: "SQLITE_UNKNOWN", message: "SQLITE_UNKNOWN: SQLite error: no such table: Workspace" },
      },
    ],
  ])("rethrows a missing table named %s", async (_where, shape) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { workspace: { findMany: vi.fn().mockRejectedValue(shape) } };

    await expect(bootCheckSingleModeDatabase(db as never)).rejects.toThrow(
      "apply the database migrations (M1) before starting",
    );
    expect(log).not.toHaveBeenCalled();
  });

  it("logs any other failure, naming the boot check, and does not throw", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const transient = new Error("SQLITE_BUSY: database is locked");
    const db = { workspace: { findMany: vi.fn().mockRejectedValue(transient) } };

    await expect(bootCheckSingleModeDatabase(db as never)).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("single-mode boot check");
    expect(log.mock.calls[0]).toContain(transient);
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
