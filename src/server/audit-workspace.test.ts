/**
 * Every workspace audit row lands in the workspace that acted (spec §5.6).
 *
 * Workspace A's owner calls every export of every "use server" module under
 * src/server/ once, on A's own records: the creates, the updates, the task
 * toggle, the Kanban move, the AI actions, search, and the deletes. Then every
 * audit row the calls wrote must carry A's workspace, every expected entry
 * must be there, and the scoped client must never have refused an audit
 * write. audit() swallows a refusal and reports it to Sentry, so the Sentry
 * spy is where a wrong workspaceId would surface.
 *
 * The AI and mail providers are mocked off: the AI actions answer with their
 * heuristics and nothing reaches a network. auth.* rows are platform events
 * with no workspace by design (auditPlatform), so they are left out.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TenancyViolation } from "@/lib/tenancy";
import {
  createTestDatabase,
  formData,
  formDataFor,
  truncateAll,
  type TestUser,
} from "@/test/action-harness";
import { twoWorkspaces } from "@/test/cross-tenant";
import {
  hasUseServerDirective,
  isTestFile,
  parseSource,
  sourceFiles,
  valueExports,
} from "@/test/source-scan";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
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

let currentUser: TestUser | null = null;
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => currentUser,
  requireUser: async () => currentUser,
  createSession: async () => {},
  destroySession: async () => {},
}));

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

// Providers off: every model call fails as "not configured" and spends nothing.
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  const off = async () => ({
    ok: false as const,
    reason: "not_configured" as const,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
  return { ...actual, aiProviderName: () => null, generateText: off, generateJson: off, generateDraft: off };
});

// Mail off: sendFollowUp takes its simulated path and only logs the activity.
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailConfigured: () => false,
    sendEmail: async () => {
      throw new Error("sendEmail must not run while email is not configured");
    },
  };
});

const companies = await import("./actions/companies");
const contacts = await import("./actions/contacts");
const deals = await import("./actions/deals");
const activities = await import("./actions/activities");
const tasks = await import("./actions/tasks");
const ai = await import("./actions/ai");
const search = await import("./actions/search");

/** Every audit action the calls below must leave, once each at least. */
const EXPECTED_ACTIONS = [
  "company.create",
  "contact.create",
  "deal.create",
  "activity.create",
  "task.create",
  "company.update",
  "contact.update",
  "deal.update",
  "deal.stage_change",
  "task.complete",
  "ai.score_contact",
  "ai.summarize_contact",
  "ai.draft_email",
  "ai.send_email",
  "activity.delete",
  "task.delete",
  "deal.delete",
  "contact.delete",
  "company.delete",
];

const called = new Set<string>();
// Built from a constant, not a "src/"-headed template: Task 19's caseKeyLiterals reads any template
// that starts with "src/" and contains "#" as a dynamic cross-tenant case key and fails the run.
const ACTIONS_DIR = "src/server/actions/";

/** Calls one export of src/server/actions/<module>.ts, and records that it was called. */
function call<T>(module: string, name: string, act: () => Promise<T>): Promise<T> {
  called.add(`${ACTIONS_DIR}${module}.ts#${name}`);
  return act();
}

/** The same, for an action that ends in redirect(): returns where it sent the user. */
async function callRedirecting(module: string, name: string, act: () => Promise<unknown>): Promise<string> {
  try {
    await call(module, name, act);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT:")) {
      return error.message.slice("NEXT_REDIRECT:".length);
    }
    throw error;
  }
  throw new Error(`${module}.ts#${name} returned instead of redirecting`);
}

/** Every value export of every "use server" module under src/server/: what this test must call. */
function serverActionKeys(): string[] {
  return sourceFiles()
    .filter((f) => f.startsWith("src/server/") && !isTestFile(f) && hasUseServerDirective(parseSource(f)))
    .flatMap((f) => valueExports(parseSource(f)).map((name) => `${f}#${name}`))
    .sort();
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workspace audit rows (spec §5.6)", () => {
  it("A's owner calls every server action on A's own records, and every audit row it writes is A's", async () => {
    vi.stubEnv("WORKSPACE_MODE", "multi");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("AI_DAILY_CEILING", "");
    await truncateAll(prisma);
    const { a } = await twoWorkspaces(prisma);
    currentUser = a.owner;
    // The fixture writes an audit row into each workspace; only the calls' rows count.
    const fixtureRows = new Set((await prisma.auditLog.findMany({ select: { id: true } })).map((r) => r.id));
    captureException.mockClear();
    const ok = { success: true };

    // Creates.
    expect(
      await call("companies", "createCompany", () => companies.createCompany({}, formData({ name: "Audit Co" }))),
    ).toEqual(ok);
    expect(
      await call("contacts", "createContact", () =>
        contacts.createContact(
          {},
          formData({ firstName: "Audra", lastName: "Trail", status: "LEAD", companyId: a.companyId }),
        ),
      ),
    ).toEqual(ok);
    expect(
      await call("deals", "createDeal", () =>
        deals.createDeal({}, formData({ title: "Audit deal", value: "500", stage: "LEAD", contactId: a.contactId })),
      ),
    ).toEqual(ok);
    expect(
      await call("activities", "createActivity", () =>
        activities.createActivity({}, formData({ type: "NOTE", content: "Audit note", contactId: a.contactId })),
      ),
    ).toEqual(ok);
    expect(
      await call("tasks", "createTask", () => tasks.createTask({}, formData({ title: "Audit task", dealId: a.dealId }))),
    ).toEqual(ok);

    // Updates, the task toggle and the Kanban move, on A's fixture records.
    const company = await prisma.company.findUniqueOrThrow({ where: { id: a.companyId } });
    expect(
      await call("companies", "updateCompany", () =>
        companies.updateCompany(a.companyId, {}, formDataFor(company, { name: "Company A, renamed" })),
      ),
    ).toEqual(ok);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: a.contactId } });
    expect(
      await call("contacts", "updateContact", () =>
        contacts.updateContact(
          a.contactId,
          {},
          formDataFor(contact, {
            firstName: contact.firstName,
            lastName: contact.lastName,
            status: "QUALIFIED",
            companyId: a.companyId,
          }),
        ),
      ),
    ).toEqual(ok);
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: a.dealId } });
    expect(
      await call("deals", "updateDeal", () =>
        deals.updateDeal(
          a.dealId,
          {},
          formDataFor(deal, {
            title: "Deal A, renamed",
            value: String(deal.value),
            stage: deal.stage,
            currency: deal.currency,
            contactId: a.contactId,
            companyId: a.companyId,
          }),
        ),
      ),
    ).toEqual(ok);
    expect(
      await call("deals", "moveDeal", () => deals.moveDeal({ dealId: a.dealId, stage: "WON", position: 0 })),
    ).toEqual({ ok: true });
    await call("tasks", "toggleTask", () => tasks.toggleTask(a.taskId));

    // The AI actions, providers off, and search.
    expect(await call("ai", "scoreContact", () => ai.scoreContact(a.contactId))).toMatchObject({
      ok: true,
      provider: "heuristic",
    });
    expect(await call("ai", "summarizeContact", () => ai.summarizeContact(a.contactId))).toMatchObject({
      ok: true,
      provider: "heuristic",
    });
    expect(await call("ai", "draftFollowUp", () => ai.draftFollowUp(a.contactId))).toMatchObject({
      ok: true,
      provider: "heuristic",
    });
    expect(
      await call("ai", "sendFollowUp", () => ai.sendFollowUp(a.contactId, "Subject: Checking in\n\nA short note.")),
    ).toMatchObject({ ok: true, provider: "email" });
    expect(await call("ai", "extractFileText", () => ai.extractFileText(new FormData()))).toEqual({
      ok: false,
      message: "No file received.",
    });
    expect(await call("ai", "currentAiProvider", () => ai.currentAiProvider())).toBe("heuristic");
    expect(await call("search", "searchRecords", () => search.searchRecords("Casey"))).toMatchObject({ ok: true });

    // Deletes, children first. Three of them leave the record's page through redirect().
    await call("activities", "deleteActivity", () => activities.deleteActivity(a.activityId));
    await call("tasks", "deleteTask", () => tasks.deleteTask(a.taskId));
    expect(await callRedirecting("deals", "deleteDeal", () => deals.deleteDeal(a.dealId))).toBe("/deals");
    expect(await callRedirecting("contacts", "deleteContact", () => contacts.deleteContact(a.contactId))).toBe(
      "/contacts",
    );
    expect(await callRedirecting("companies", "deleteCompany", () => companies.deleteCompany(a.companyId))).toBe(
      "/companies",
    );

    const written = (
      await prisma.auditLog.findMany({ select: { id: true, action: true, workspaceId: true } })
    ).filter((row) => !fixtureRows.has(row.id));
    const workspaceRows = written.filter((row) => !row.action.startsWith("auth."));

    // Every workspace row the calls wrote is A's.
    expect(workspaceRows.filter((row) => row.workspaceId !== a.workspaceId)).toEqual([]);
    // No audit write was refused by the scoped client and swallowed.
    expect(captureException.mock.calls.filter(([error]) => error instanceof TenancyViolation)).toEqual([]);
    // And every entry the calls should leave is there.
    expect(workspaceRows.map((row) => row.action)).toEqual(expect.arrayContaining(EXPECTED_ACTIONS));
    // Nothing under src/server/ was skipped: a new server action must be called above.
    expect(
      serverActionKeys().filter((key) => !called.has(key)),
      "Call the new server action above, on A's own records",
    ).toEqual([]);
  }, 30_000);
});
