/**
 * createTestDatabase({ through }) builds a database at an older schema, so a
 * migration's data statements can be tested against fixtures inserted with raw
 * SQL (spec §9.8), and applyRemaining() then runs the later migrations the way
 * every runner runs them.
 */
import { existsSync, mkdtempSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workspace-bootstrap";
import { createTestDatabase, makeUser, makeWorkspace, truncateAll } from "./action-harness";

// The real node:fs, with mkdtempSync observable: whether a call made a temp
// directory cannot be read back from %TEMP% while other test files run.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdtempSync: vi.fn(actual.mkdtempSync) };
});

// Chosen to be independent of M1: the migration after it adds Deal.baseValue.
const FK_INDEXES = "20260725150849_add_deal_task_fk_indexes";

const made: Array<ReturnType<typeof createTestDatabase>> = [];
afterEach(async () => {
  for (const db of made.splice(0)) await db.destroy();
});

function track(db: ReturnType<typeof createTestDatabase>) {
  made.push(db);
  return db;
}

function columns(file: string, table: string): string[] {
  const raw = new Database(file, { readonly: true });
  try {
    return (raw.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
  } finally {
    raw.close();
  }
}

describe("createTestDatabase({ through })", () => {
  it("stops after the named migration, inclusive, and applies the rest on demand", () => {
    const db = track(createTestDatabase({ through: FK_INDEXES }));
    expect(columns(db.file, "Deal")).toContain("value");
    expect(columns(db.file, "Deal")).not.toContain("baseValue");

    db.applyRemaining();

    expect(columns(db.file, "Deal")).toContain("baseValue");
  });

  it("does not re-run anything the second time", () => {
    const db = track(createTestDatabase({ through: FK_INDEXES }));
    db.applyRemaining();
    const raw = new Database(db.file);
    try {
      raw.exec(`
        INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt") VALUES ('u1', 'u1@example.com', 'U', 'x', '2026-01-01T00:00:00.000+00:00');
        INSERT INTO "Deal" ("id", "title", "value", "baseValue", "ownerId", "updatedAt") VALUES ('d1', 'Sentinel', 1, 5, 'u1', '2026-01-01T00:00:00.000+00:00');
      `);
    } finally {
      raw.close();
    }

    // A re-run of the fx migration would rebuild Deal and reset baseValue to value.
    db.applyRemaining();

    const check = new Database(db.file, { readonly: true });
    try {
      expect(check.prepare(`SELECT "baseValue" FROM "Deal" WHERE "id" = 'd1'`).get()).toEqual({ baseValue: 5 });
    } finally {
      check.close();
    }
  });

  it("refuses a migration name that does not exist, before making a temp directory", () => {
    vi.mocked(mkdtempSync).mockClear();

    expect(() => createTestDatabase({ through: "nope" })).toThrow('createTestDatabase: no migration directory named "nope"');
    expect(mkdtempSync).not.toHaveBeenCalled();
  });

  it("still builds the full schema by default", async () => {
    const db = track(createTestDatabase());
    expect(existsSync(db.file)).toBe(true);
    db.applyRemaining(); // nothing left: re-running the init migration would throw
    expect(await db.prisma.user.count()).toBe(0);
  });
});

// The workspace-aware helpers share one full-schema database, emptied before
// each test. The hooks live in this block so the createTestDatabase tests
// above keep their own per-test databases.
describe("workspace-aware helpers", () => {
  const { prisma, destroy } = createTestDatabase();

  afterAll(async () => {
    await destroy();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  describe("makeUser", () => {
    it("joins the default workspace as MEMBER unless told otherwise", async () => {
      const user = await makeUser(prisma, { email: "ann@example.com" });

      expect(user).toMatchObject({ email: "ann@example.com", name: "ann", role: "MEMBER", workspaceId: DEFAULT_WORKSPACE_ID });
      expect(await prisma.membership.findUnique({ where: { userId: user.id } })).toMatchObject({
        workspaceId: DEFAULT_WORKSPACE_ID,
        role: "MEMBER",
      });
      expect(await prisma.workspace.count()).toBe(1);
    });

    it("reuses the default workspace for later users", async () => {
      await makeUser(prisma, { email: "a@example.com" });
      await makeUser(prisma, { email: "b@example.com", role: "ADMIN" });

      expect(await prisma.workspace.count()).toBe(1);
      expect(await prisma.membership.count({ where: { workspaceId: DEFAULT_WORKSPACE_ID } })).toBe(2);
    });

    it("puts a user in the workspace and role it is given", async () => {
      const ws = await makeWorkspace(prisma, { id: "ws_x" });
      const user = await makeUser(prisma, { email: "o@example.com", role: "OWNER", workspaceId: ws.id });

      expect(user).toMatchObject({ role: "OWNER", workspaceId: "ws_x" });
      expect(await prisma.workspace.count()).toBe(1);
    });
  });

  describe("makeWorkspace", () => {
    it("creates FREE, non-demo workspaces with unique slugs by default", async () => {
      const one = await makeWorkspace(prisma);
      const two = await makeWorkspace(prisma);

      const rows = await prisma.workspace.findMany({ where: { id: { in: [one.id, two.id] } } });
      expect(rows).toHaveLength(2);
      expect(rows.every((w) => w.plan === "FREE" && !w.isDemo)).toBe(true);
      expect(new Set(rows.map((w) => w.slug)).size).toBe(2);
    });

    it("applies overrides", async () => {
      await makeWorkspace(prisma, { id: "ws_demo", name: "Demo", slug: "demo", plan: "PAID", isDemo: true });

      expect(await prisma.workspace.findUnique({ where: { id: "ws_demo" } })).toMatchObject({
        name: "Demo",
        slug: "demo",
        plan: "PAID",
        isDemo: true,
      });
    });
  });

  describe("truncateAll", () => {
    it("also empties memberships, AI usage and workspaces", async () => {
      const user = await makeUser(prisma, { email: "t@example.com" });
      await prisma.aiUsage.create({
        data: { workspaceId: user.workspaceId, action: "score", outcome: "pending" },
      });

      await truncateAll(prisma);

      expect(await prisma.membership.count()).toBe(0);
      expect(await prisma.aiUsage.count()).toBe(0);
      expect(await prisma.workspace.count()).toBe(0);
      expect(await prisma.user.count()).toBe(0);
    });
  });
});
