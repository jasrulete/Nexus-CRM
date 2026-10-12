/**
 * M1 (workspaces_expand) backfill: spec §9.8 and §10, phase A.
 *
 * Each database is built through the last pre-M1 migration, fixtures go in
 * with raw SQL (the generated client only knows the current schema), and
 * then the remaining migrations run exactly as every runner runs them.
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { checkM1, type Query, type Row } from "@/lib/migration-checks";
import { createTestDatabase } from "./action-harness";

const PRE_M1 = "20260823151943_add_deal_base_value_and_fx_rate";
// The literal M1 writes. DEFAULT_WORKSPACE_ID (src/lib/workspace-bootstrap.ts) must equal it.
const WS = "ws_default";

const FIXTURES = `
INSERT INTO "User" ("id", "email", "name", "passwordHash", "role", "createdAt", "updatedAt") VALUES
  ('u_admin', 'admin@example.com', 'Ada Admin', 'x', 'ADMIN', '2026-01-01T09:00:00.000+00:00', '2026-01-01T09:00:00.000+00:00'),
  ('u_member', 'member@example.com', 'Mo Member', 'x', 'MEMBER', '2026-02-01T09:00:00.000+00:00', '2026-02-01T09:00:00.000+00:00');
INSERT INTO "Company" ("id", "name", "ownerId", "updatedAt") VALUES
  ('co_1', 'Acme', 'u_admin', '2026-03-01T09:00:00.000+00:00');
INSERT INTO "Contact" ("id", "firstName", "lastName", "companyId", "ownerId", "updatedAt") VALUES
  ('ct_1', 'Cy', 'One', 'co_1', 'u_admin', '2026-03-01T09:00:00.000+00:00'),
  ('ct_2', 'Di', 'Two', NULL, 'u_member', '2026-03-01T09:00:00.000+00:00');
INSERT INTO "Deal" ("id", "title", "value", "baseValue", "contactId", "companyId", "ownerId", "updatedAt") VALUES
  ('dl_1', 'Renewal', 500, 500, 'ct_1', 'co_1', 'u_member', '2026-03-01T09:00:00.000+00:00');
INSERT INTO "Activity" ("id", "type", "content", "contactId", "dealId", "userId") VALUES
  ('ac_1', 'NOTE', 'Called', 'ct_1', 'dl_1', 'u_admin');
INSERT INTO "Task" ("id", "title", "dealId", "assigneeId") VALUES
  ('tk_1', 'Send the quote', 'dl_1', 'u_member');
INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "userId") VALUES
  ('al_login', 'auth.login', 'User', 'u_admin', 'u_admin'),
  ('al_failed', 'auth.login_failed', 'User', 'nobody@example.com', NULL),
  ('al_create', 'contact.create', 'Contact', 'ct_1', 'u_admin'),
  ('al_seed', 'system.seed', 'Workspace', 'seed', NULL);
`;

const made: Array<ReturnType<typeof createTestDatabase>> = [];
afterEach(async () => {
  for (const db of made.splice(0)) await db.destroy();
});

function preM1() {
  const db = createTestDatabase({ through: PRE_M1 });
  made.push(db);
  return db;
}

function rawExec(file: string, sql: string): void {
  const raw = new Database(file);
  try {
    raw.exec(sql);
  } finally {
    raw.close();
  }
}

const sqlite =
  (file: string): Query =>
  async (sql) => {
    const raw = new Database(file, { readonly: true });
    try {
      return raw.prepare(sql).all() as Row[];
    } finally {
      raw.close();
    }
  };

describe("M1 on an install with users", () => {
  function migrated() {
    const db = preM1();
    rawExec(db.file, FIXTURES);
    db.applyRemaining();
    return db;
  }

  it("creates the one default workspace, with timestamps Prisma can read", async () => {
    const before = Date.now();
    const { prisma } = migrated();
    const workspaces = await prisma.workspace.findMany();
    expect(workspaces).toHaveLength(1);
    const [ws] = workspaces;
    expect(ws).toMatchObject({ id: WS, slug: "default", name: "Default workspace", isDemo: false, plan: "FREE" });
    for (const at of [ws.createdAt, ws.updatedAt]) {
      expect(at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it("gives every user exactly one membership, copying the role as is", async () => {
    const { prisma } = migrated();
    const memberships = await prisma.membership.findMany({ orderBy: { userId: "asc" } });
    expect(memberships.map(({ id, workspaceId, userId, role }) => ({ id, workspaceId, userId, role }))).toEqual([
      { id: "mem_u_admin", workspaceId: WS, userId: "u_admin", role: "ADMIN" },
      { id: "mem_u_member", workspaceId: WS, userId: "u_member", role: "MEMBER" },
    ]);
    // Nobody is promoted: on the demo database the earliest admin is the published demo account.
    expect(memberships.some((m) => m.role === "OWNER")).toBe(false);
    // "Member since" is the sign-up date, so the roster keeps today's order.
    expect(memberships.map((m) => m.createdAt.toISOString())).toEqual([
      "2026-01-01T09:00:00.000Z",
      "2026-02-01T09:00:00.000Z",
    ]);
  });

  it("moves every CRM row into the default workspace", async () => {
    const { prisma } = migrated();
    const select = { id: true, workspaceId: true } as const;
    const rows = (
      await Promise.all([
        prisma.company.findMany({ select }),
        prisma.contact.findMany({ select }),
        prisma.deal.findMany({ select }),
        prisma.activity.findMany({ select }),
        prisma.task.findMany({ select }),
      ])
    ).flat();
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.workspaceId !== WS)).toEqual([]);
  });

  it("puts workspace audit rows in the workspace and leaves platform (auth.*) rows null", async () => {
    const { prisma } = migrated();
    const audit = await prisma.auditLog.findMany({ select: { id: true, workspaceId: true }, orderBy: { id: "asc" } });
    expect(audit).toEqual([
      { id: "al_create", workspaceId: WS },
      { id: "al_failed", workspaceId: null },
      { id: "al_login", workspaceId: null },
      { id: "al_seed", workspaceId: WS },
    ]);
  });

  // Slow: it builds two databases through the migrations (7-9s under parallel load; the default is 5s).
  it("passes every check of the M1 verify gate", async () => {
    const db = migrated();
    const reference = createTestDatabase();
    made.push(reference);
    const checks = await checkM1(sqlite(db.file), {
      reference: sqlite(reference.file),
      migrationNames: null,
      backupCounts: null,
    });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  }, 30_000);
});

describe("M1 on an install with no users", () => {
  it("creates no workspace and no memberships", async () => {
    const db = preM1();
    db.applyRemaining();
    expect(await db.prisma.workspace.count()).toBe(0);
    expect(await db.prisma.membership.count()).toBe(0);
  });

  it("leaves orphaned audit rows unassigned rather than point them at a workspace that does not exist", async () => {
    const db = preM1();
    rawExec(
      db.file,
      `INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "userId") VALUES ('al_orphan', 'contact.delete', 'Contact', 'gone', NULL);`,
    );
    db.applyRemaining();
    expect(await db.prisma.workspace.count()).toBe(0);
    expect(await db.prisma.auditLog.findMany({ select: { id: true, workspaceId: true } })).toEqual([
      { id: "al_orphan", workspaceId: null },
    ]);
  });
});
