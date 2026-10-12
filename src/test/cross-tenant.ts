/**
 * The two-workspace fixture behind the cross-tenant suite (spec §9.1).
 *
 * A cross-tenant case acts as workspace A's owner, aims at workspace B's ids,
 * and asserts two things: the action answers "not found" or "forbidden", and
 * `snapshotWorkspace(prisma, b.workspaceId)` is byte-for-byte what it was before.
 *
 * Every test file that adds a case calls `registerCrossTenantCase` at module
 * top level with a single plain string literal, e.g.
 *
 *   registerCrossTenantCase("src/server/actions/contacts.ts#updateContact");
 *
 * Vitest isolates modules per test file, so `crossTenantCases` only sees the
 * keys registered in the file that reads it. A completeness check that spans
 * files must find the keys by scanning test sources for that literal call.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { TENANT_MODELS } from "@/lib/tenancy-map";
import { makeUser, makeWorkspace, type TestUser } from "./action-harness";

export type TenantFixture = {
  workspaceId: string;
  owner: TestUser;
  companyId: string;
  contactId: string;
  dealId: string;
  taskId: string;
  activityId: string;
};

async function seedTenant(prisma: PrismaClient, label: "A" | "B"): Promise<TenantFixture> {
  const key = label.toLowerCase();
  const { id: workspaceId } = await makeWorkspace(prisma, {
    id: `ws_${key}`,
    name: `Workspace ${label}`,
    slug: `workspace-${key}`,
  });
  const owner = await makeUser(prisma, {
    email: `owner-${key}@example.com`,
    name: `Owner ${label}`,
    role: "OWNER",
    workspaceId,
  });
  const company = await prisma.company.create({
    data: { name: `Company ${label}`, ownerId: owner.id, workspaceId },
  });
  const contact = await prisma.contact.create({
    data: {
      firstName: "Casey",
      lastName: label,
      email: `casey-${key}@example.com`,
      companyId: company.id,
      ownerId: owner.id,
      workspaceId,
    },
  });
  const deal = await prisma.deal.create({
    data: {
      title: `Deal ${label}`,
      value: 1000,
      baseValue: 1000,
      contactId: contact.id,
      companyId: company.id,
      ownerId: owner.id,
      workspaceId,
    },
  });
  const task = await prisma.task.create({
    data: { title: `Task ${label}`, contactId: contact.id, dealId: deal.id, assigneeId: owner.id, workspaceId },
  });
  const activity = await prisma.activity.create({
    data: {
      type: "NOTE",
      content: `Note ${label}`,
      contactId: contact.id,
      dealId: deal.id,
      companyId: company.id,
      userId: owner.id,
      workspaceId,
    },
  });
  await prisma.auditLog.create({
    data: { action: "contact.create", entityType: "contact", entityId: contact.id, userId: owner.id, workspaceId },
  });
  // No AiUsage rows: Task 14 and Task 16 seed exactly the usage rows each test needs, and a
  // fixture row would silently count toward their allowance and ceiling arithmetic.
  return {
    workspaceId,
    owner,
    companyId: company.id,
    contactId: contact.id,
    dealId: deal.id,
    taskId: task.id,
    activityId: activity.id,
  };
}

/** Two fully seeded workspaces. Call after truncateAll. */
export async function twoWorkspaces(
  prisma: PrismaClient,
): Promise<{ a: TenantFixture; b: TenantFixture }> {
  return { a: await seedTenant(prisma, "A"), b: await seedTenant(prisma, "B") };
}

// Untyped delegate lookup, so one loop can read every model in TENANT_MODELS.
type Delegate = Record<string, (args?: unknown) => Promise<unknown>>;

function delegateOf(client: PrismaClient, model: string): Delegate {
  return (client as unknown as Record<string, Delegate>)[model[0].toLowerCase() + model.slice(1)];
}

/**
 * Every row that belongs to one workspace, as stable JSON: the workspace, the
 * users of its memberships, and a section per model in `TENANT_MODELS`, each
 * ordered by id. The tenant sections come from that map rather than a list kept
 * here, so a model added to it is covered by construction. Equal before and
 * after a call means the call changed nothing there.
 */
export async function snapshotWorkspace(prisma: PrismaClient, workspaceId: string): Promise<string> {
  const where = { workspaceId };
  const orderBy = { id: "asc" } as const;
  const tenantRows: Record<string, unknown> = {};
  for (const model of TENANT_MODELS) {
    tenantRows[model] = await delegateOf(prisma, model).findMany({ where, orderBy });
  }
  const memberships = await prisma.membership.findMany({ where, select: { userId: true } });
  return JSON.stringify({
    workspace: await prisma.workspace.findUnique({ where: { id: workspaceId } }),
    users: await prisma.user.findMany({
      where: { id: { in: memberships.map((m) => m.userId) } },
      orderBy,
    }),
    tenantRows,
  });
}

/**
 * Exports of `'use server'` modules that never touch the database, so they
 * need no cross-tenant case. Keyed by module path from the repo root.
 */
export const CROSS_TENANT_EXEMPT: Record<string, readonly string[]> = {
  "src/server/actions/ai.ts": ["extractFileText", "currentAiProvider"],
};

/** "src/server/actions/contacts.ts#updateContact" for every case registered in this file. */
export const crossTenantCases = new Set<string>();

/**
 * The shape of a case key: "src/", a module path (route groups, dynamic
 * segments and @slots allowed; .ts or .tsx), "#", and an export name. Task 19's
 * completeness scanner matches the first argument of each
 * registerCrossTenantCase() call in the test sources against this same pattern.
 */
export const CASE_KEY = /^src\/[\w./()[\]@-]+\.tsx?#[A-Za-z_$][\w$]*$/;

/**
 * Records one cross-tenant case. Pass the key as a single plain string literal
 * at module top level: never a template, a concatenation or a loop variable.
 * Task 19 reads the keys statically from the test sources (vitest isolates
 * modules per file, so this Set never sees another file's keys), and a key it
 * cannot read is a missing case.
 */
export function registerCrossTenantCase(key: string): void {
  if (!CASE_KEY.test(key)) {
    throw new Error(`Cross-tenant case keys look like "src/server/actions/contacts.ts#updateContact", got "${key}"`);
  }
  crossTenantCases.add(key);
}
