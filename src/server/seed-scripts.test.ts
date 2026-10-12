/**
 * The seed and reset entry points, run the way an operator or a workflow runs
 * them: as their own process under tsx, against a throwaway database built
 * from the real migrations. The units they wrap are tested beside those units
 * (seed-data.test.ts, src/lib/demo-reset.test.ts,
 * src/lib/workspace-maintenance.test.ts). What only a real process shows is
 * the wrapper itself: which check runs first, and the exit status a person or
 * reset-demo.yml sees.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, makeUser, makeWorkspace, truncateAll } from "@/test/action-harness";
import { DEMO_EMAIL } from "@/lib/demo-guard";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workspace-bootstrap";

const { prisma, file, destroy } = createTestDatabase();
const TSX_CLI = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const DAY = 86_400_000;
const SPAWN_TIMEOUT = 90_000;

function run(script: string, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [TSX_CLI, script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT,
    env: {
      ...process.env,
      DATABASE_URL: `file:${file}`,
      // Whatever a developer's .env carries, these runs stay on the throwaway
      // file: the adapter, the reset target and the seed all read these flags,
      // and dotenv never overrides a variable that is already set.
      ALLOW_REMOTE_DB: "false",
      SEED_REMOTE: "false",
      SEED_DEMO_WORKSPACE: "false",
      WORKSPACE_MODE: "single",
      // Blank on purpose, and for the same reason: dotenv treats a blank value
      // as set, so the child never even loads the remote credentials.
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
      ...env,
    },
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

async function tableCounts() {
  const [users, workspaces, memberships, companies, contacts, deals, activities, tasks, auditLogs] =
    await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.membership.count(),
      prisma.company.count(),
      prisma.contact.count(),
      prisma.deal.count(),
      prisma.activity.count(),
      prisma.task.count(),
      prisma.auditLog.count(),
    ]);
  return { users, workspaces, memberships, companies, contacts, deals, activities, tasks, auditLogs };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  await truncateAll(prisma);
});

describe("npm run db:seed (prisma/seed.ts)", () => {
  it(
    "seeds an empty database: the demo account can sign in and owns its data in the one workspace",
    async () => {
      const { status, output } = run("prisma/seed.ts");

      expect(status, output).toBe(0);
      expect(output).toContain("Seeded demo workspace");
      const demo = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
      expect(await bcrypt.compare("demo-password-123", demo.passwordHash)).toBe(true);
      expect(await prisma.membership.findUniqueOrThrow({ where: { userId: demo.id } })).toMatchObject({
        workspaceId: DEFAULT_WORKSPACE_ID,
        role: "ADMIN",
      });
      expect(await prisma.workspace.findMany({ select: { id: true, isDemo: true } })).toEqual([
        { id: DEFAULT_WORKSPACE_ID, isDemo: false },
      ]);
      expect(await prisma.contact.count({ where: { workspaceId: DEFAULT_WORKSPACE_ID } })).toBe(12);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "marks the workspace as the demo only with SEED_DEMO_WORKSPACE=true",
    async () => {
      const { status, output } = run("prisma/seed.ts", { SEED_DEMO_WORKSPACE: "true" });

      expect(status, output).toBe(0);
      expect(
        (await prisma.workspace.findUniqueOrThrow({ where: { id: DEFAULT_WORKSPACE_ID } })).isDemo,
      ).toBe(true);
    },
    SPAWN_TIMEOUT,
  );
});

describe("every seed, reset and workspace script refuses WORKSPACE_MODE=multi", () => {
  it.each([
    "prisma/seed.ts",
    "prisma/add-demo-member.ts",
    "scripts/reset-demo.ts",
    "scripts/mark-demo-workspace.ts",
    "scripts/backfill-workspace.ts",
  ])(
    "%s exits non-zero and writes nothing",
    async (script) => {
      const { status, output } = run(script, { WORKSPACE_MODE: "multi" });

      expect(status, output).not.toBe(0);
      expect(output).toContain("refuses to run when WORKSPACE_MODE=multi");
      expect(await tableCounts()).toEqual({
        users: 0,
        workspaces: 0,
        memberships: 0,
        companies: 0,
        contacts: 0,
        deals: 0,
        activities: 0,
        tasks: 0,
        auditLogs: 0,
      });
    },
    SPAWN_TIMEOUT,
  );
});

describe("npm run demo:reset (scripts/reset-demo.ts)", () => {
  // Review focus 5: a self-hosted install, or a misconfigured secret pointing
  // the nightly workflow at a database that is not the demo.
  it(
    "refuses a database whose only workspace is not the demo: non-zero exit, nothing deleted, the flag untouched",
    async () => {
      const ws = await makeWorkspace(prisma, { id: DEFAULT_WORKSPACE_ID, slug: "default", isDemo: false });
      const owner = await makeUser(prisma, { email: "owner@selfhost.example", role: "OWNER", workspaceId: ws.id });
      await makeUser(prisma, { email: DEMO_EMAIL, role: "ADMIN", workspaceId: ws.id });
      await prisma.contact.create({
        data: { firstName: "Real", lastName: "Customer", status: "CUSTOMER", ownerId: owner.id, workspaceId: ws.id },
      });
      // Old enough that the prune would take it, so its survival proves the
      // prune never ran either.
      await prisma.auditLog.create({
        data: {
          action: "contact.create",
          entityType: "contact",
          entityId: "real-customer",
          userId: owner.id,
          workspaceId: ws.id,
          createdAt: new Date(Date.now() - 60 * DAY),
        },
      });
      const before = await tableCounts();

      const { status, output } = run("scripts/reset-demo.ts");

      expect(status, output).not.toBe(0);
      expect(output).toContain("RESET_REFUSED");
      expect(await tableCounts()).toEqual(before);
      expect((await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } })).isDemo).toBe(false);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "rebuilds a marked demo workspace and exits 0",
    async () => {
      const ws = await makeWorkspace(prisma, { id: DEFAULT_WORKSPACE_ID, slug: "default", isDemo: true });
      await makeUser(prisma, { email: DEMO_EMAIL, role: "ADMIN", workspaceId: ws.id });
      const visitor = await makeUser(prisma, { email: "visitor@example.com", workspaceId: ws.id });
      await prisma.contact.create({
        data: { firstName: "Visitor", lastName: "Junk", status: "LEAD", ownerId: visitor.id, workspaceId: ws.id },
      });

      const { status, output } = run("scripts/reset-demo.ts");

      expect(status, output).toBe(0);
      expect(output).toContain("Demo workspace reset.");
      expect(await prisma.contact.count({ where: { lastName: "Junk" } })).toBe(0);
      expect(await prisma.contact.count({ where: { workspaceId: ws.id } })).toBe(12);
      expect(await prisma.user.count({ where: { email: "visitor@example.com" } })).toBe(1);
      expect((await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } })).isDemo).toBe(true);
    },
    SPAWN_TIMEOUT,
  );
});
