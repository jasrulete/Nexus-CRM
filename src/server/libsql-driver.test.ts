/**
 * The production driver, on a local file (spec §9.4).
 *
 * Production talks to Turso through PrismaLibSql, and that adapter holds one
 * lock for every query and every interactive transaction until the
 * transaction commits. So inside a $transaction callback, a query through any
 * client other than the callback's own `tx` — systemDb, the outer scoped
 * client, or a helper that closes over one, such as audit() without its db
 * argument — waits for a lock its own transaction holds, until the
 * transaction times out (spec §5.2).
 *
 * The rest of the suite runs on better-sqlite3, whose adapter takes that lock
 * only to open a transaction: there the same mistake runs silently inside the
 * transaction and every test passes. This file runs the paths that open
 * interactive transactions — multi-mode register(), the create actions, the
 * delete actions and moveDeal — on PrismaLibSql over the harness's migrated
 * `file:` database, so a §5.2 violation fails here first, and pins the
 * deadlock itself as a fixture.
 *
 * Review Focus 2 runs here too, across clients: two first sign-ups on a fresh
 * single-mode install, each through its own PrismaLibSql client on the same
 * file, the way two serverless instances share one database. No adapter lock
 * spans two clients, so SQLite's own locking decides the race.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createTestDatabase, formData } from "@/test/action-harness";

/** libSQL parses `file:` URLs itself: forward slashes keep a Windows drive path from reading as a URL authority. */
const fileUrl = (file: string) => `file:${file.split("\\").join("/")}`;

const harness = createTestDatabase();
const libsql = new PrismaClient({ adapter: new PrismaLibSql({ url: fileUrl(harness.file) }) });

// A fresh install for the sign-up race, and two clients of its own on it.
const fresh = createTestDatabase();
const racers = [
  new PrismaClient({ adapter: new PrismaLibSql({ url: fileUrl(fresh.file) }) }),
  new PrismaClient({ adapter: new PrismaLibSql({ url: fileUrl(fresh.file) }) }),
] as const;

/**
 * The client systemDb stands for during one call. Unset, it is `libsql`; a
 * call started inside `viaClient.run(client, …)` sees `client` for its whole
 * async chain, so two concurrent register() calls can each have their own.
 */
const viaClient = new AsyncLocalStorage<PrismaClient>();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  const systemDb = new Proxy(libsql, {
    get(_target, property) {
      const client = viaClient.getStore() ?? libsql;
      const value: unknown = Reflect.get(client, property, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
  return {
    systemDb,
    prisma: systemDb,
    scopeToWorkspace,
    forWorkspace: (ws: string) => scopeToWorkspace(libsql, ws),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const request = vi.hoisted(() => ({ ip: "10.40.0.1" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": request.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

type SessionUser = { id: string; email: string; name: string; createdAt: Date; updatedAt: Date };
let currentUser: SessionUser | null = null;
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => currentUser,
  requireUser: async () => {
    if (!currentUser) throw new Error("UNAUTHORIZED");
    return currentUser;
  },
  createSession: async () => {},
  destroySession: async () => {},
}));

// bcrypt at cost 12 costs a quarter of a second per call and proves nothing
// about the driver. When `gate.barrier` is set, every hash waits there until
// all expected callers arrive, so racing sign-ups have all passed the email
// check before any of their transactions starts.
const gate = vi.hoisted(() => ({ barrier: null as null | (() => Promise<void>) }));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: async (password: string) => {
    await gate.barrier?.();
    return `hashed:${password}`;
  },
  verifyPassword: async (password: string, hash: string) => hash === `hashed:${password}`,
}));

const { register } = await import("@/lib/auth/actions");
const { createCompany, deleteCompany } = await import("@/server/actions/companies");
const { createContact, deleteContact } = await import("@/server/actions/contacts");
const { createDeal, moveDeal } = await import("@/server/actions/deals");

/**
 * Removes a harness database. On Windows a libSQL file can stay locked for a
 * moment after its client closed, and the delete fails with EPERM, so that one
 * error is retried a few times and then let go. This is clean-up only: every
 * other error, and everything in a test body, still fails.
 */
async function destroyHarness(database: { destroy(): Promise<void> }) {
  const attempts = 5;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await database.destroy();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      if (attempt === attempts) return;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

const savedMode = process.env.WORKSPACE_MODE;
beforeAll(() => {
  process.env.WORKSPACE_MODE = "multi";
});
afterAll(async () => {
  if (savedMode === undefined) delete process.env.WORKSPACE_MODE;
  else process.env.WORKSPACE_MODE = savedMode;
  // Every libSQL client is closed before its file is removed.
  await libsql.$disconnect();
  await Promise.all(racers.map((client) => client.$disconnect()));
  await destroyHarness(harness);
  await destroyHarness(fresh);
});

function barrier(callers: number): () => Promise<void> {
  let arrived = 0;
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === callers) open();
    await opened;
  };
}

/** The path a mocked `redirect()` was called with, or undefined when `error` is not a redirect. */
function redirectTarget(error: unknown): string | undefined {
  const prefix = "NEXT_REDIRECT:";
  if (!(error instanceof Error) || !error.message.startsWith(prefix)) return undefined;
  return error.message.slice(prefix.length);
}

let seq = 0;
/** Registers through the real action and returns the user it created. */
async function signUp(name: string, email: string) {
  // Its own source address per sign-up: the register limit is 5 per 15 minutes.
  request.ip = `10.40.${++seq}.1`;
  let redirectedTo: string | undefined;
  try {
    const state = await register({}, formData({ name, email, password: "correct horse battery" }));
    throw new Error(`register returned instead of redirecting: ${JSON.stringify(state)}`);
  } catch (error) {
    redirectedTo = redirectTarget(error);
    if (redirectedTo === undefined) throw error;
  }
  const user = await libsql.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
  });
  return { user, redirectedTo };
}

/** A new multi-mode sign-up, made the current user: the OWNER of a workspace of their own. */
async function signInAsNewOwner(name: string, email: string) {
  const { user } = await signUp(name, email);
  currentUser = user;
  const { workspaceId } = await libsql.membership.findUniqueOrThrow({ where: { userId: user.id } });
  return { user, workspaceId };
}

const SIGNUP_RETRY = "Sign-up could not complete. Please try again.";

/** Runs register through `client` and reports how it ended: signed in, or the form state it returned. */
async function attempt(client: PrismaClient, name: string, email: string) {
  return viaClient.run(client, async () => {
    try {
      const state = await register({}, formData({ name, email, password: "correct horse battery" }));
      return { signedIn: false, state };
    } catch (error) {
      const to = redirectTarget(error);
      if (to === undefined) throw error;
      expect(to).toBe("/dashboard");
      return { signedIn: true, state: {} };
    }
  });
}

describe("the transaction rule (spec §5.2)", () => {
  it("a query through the outer client inside a transaction callback stalls until the transaction expires", async () => {
    await expect(
      libsql.$transaction(
        async (tx) => {
          await tx.company.count();
          // The mistake §5.2 forbids: the outer client waits on the adapter
          // lock that `tx` holds.
          return libsql.company.count();
        },
        { maxWait: 1_000, timeout: 1_000 },
      ),
    ).rejects.toThrow(/expired transaction|Transaction already closed/);
  }, 20_000);

  it("the same work through tx commits", async () => {
    const [first, second] = await libsql.$transaction(
      async (tx) => [await tx.company.count(), await tx.company.count()],
      { maxWait: 1_000, timeout: 1_000 },
    );
    expect(first).toBe(second);
  });

  it("better-sqlite3 runs the outer call silently inside the transaction, which is why this file exists", async () => {
    await expect(
      harness.prisma.$transaction(
        async (tx) => {
          await tx.company.count();
          return harness.prisma.company.count();
        },
        { maxWait: 1_000, timeout: 1_000 },
      ),
    ).resolves.toBeTypeOf("number");
  });
});

describe("the actions on the production driver", () => {
  it("multi-mode register commits the user, a new workspace and its OWNER membership", async () => {
    const { user, redirectedTo } = await signUp("Lena Libsql", "lena@libsql.test");

    expect(redirectedTo).toBe("/dashboard");
    const membership = await libsql.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.role).toBe("OWNER");
    const workspace = await libsql.workspace.findUniqueOrThrow({ where: { id: membership.workspaceId } });
    expect(workspace).toMatchObject({ name: "Lena Libsql's workspace", plan: "FREE", isDemo: false });
    // Written after commit, through systemDb, as a platform event.
    const registered = await libsql.auditLog.findFirstOrThrow({
      where: { action: "auth.register", entityId: user.id },
    });
    expect(registered.workspaceId).toBeNull();
  }, 20_000);

  it("createCompany, createContact with a companyId and createDeal complete and stay in the workspace", async () => {
    const { user } = await signUp("Omar Owner", "omar@libsql.test");
    currentUser = user;
    const { workspaceId } = await libsql.membership.findUniqueOrThrow({ where: { userId: user.id } });

    expect(await createCompany({}, formData({ name: "Driver Co" }))).toEqual({ success: true });
    const company = await libsql.company.findFirstOrThrow({ where: { name: "Driver Co" } });
    expect(company.workspaceId).toBe(workspaceId);

    expect(
      await createContact(
        {},
        formData({ firstName: "Dee", lastName: "Driver", status: "LEAD", companyId: company.id }),
      ),
    ).toEqual({ success: true });
    const contact = await libsql.contact.findFirstOrThrow({ where: { lastName: "Driver" } });
    expect(contact).toMatchObject({ workspaceId, companyId: company.id, ownerId: user.id });

    expect(
      await createDeal(
        {},
        formData({
          title: "Driver deal",
          value: "1200",
          stage: "LEAD",
          currency: "USD",
          contactId: contact.id,
          companyId: company.id,
        }),
      ),
    ).toEqual({ success: true });
    const deal = await libsql.deal.findFirstOrThrow({ where: { title: "Driver deal" } });
    expect(deal).toMatchObject({
      workspaceId,
      contactId: contact.id,
      companyId: company.id,
      ownerId: user.id,
      position: 0,
    });

    const audited = await libsql.auditLog.findMany({
      where: { action: { in: ["company.create", "contact.create", "deal.create"] } },
      select: { action: true, workspaceId: true },
      orderBy: { action: "asc" },
    });
    expect(audited).toEqual([
      { action: "company.create", workspaceId },
      { action: "contact.create", workspaceId },
      { action: "deal.create", workspaceId },
    ]);
  }, 30_000);

  // The three actions below write and audit inside one transaction callback, so
  // a stray systemDb or ctx.db query there passes on better-sqlite3 and
  // deadlocks here. They run on the actions' own default transaction timeout: a
  // deadlock fails fast as an expired transaction, never as a raised limit.
  it("deleteContact removes the contact and writes its audit row in the workspace", async () => {
    const { user, workspaceId } = await signInAsNewOwner("Dora Deleter", "dora@libsql.test");
    const contact = await libsql.contact.create({
      data: { firstName: "Gone", lastName: "Contact", status: "LEAD", ownerId: user.id, workspaceId },
    });

    await expect(deleteContact(contact.id)).rejects.toThrow("NEXT_REDIRECT:/contacts");

    expect(await libsql.contact.count({ where: { id: contact.id } })).toBe(0);
    const entry = await libsql.auditLog.findFirstOrThrow({
      where: { action: "contact.delete", entityId: contact.id },
    });
    expect(entry).toMatchObject({ entityType: "contact", userId: user.id, workspaceId });
    expect(JSON.parse(entry.metadata ?? "null")).toEqual({ name: "Gone Contact" });
  }, 20_000);

  it("deleteCompany removes the company and writes its audit row in the workspace", async () => {
    const { user, workspaceId } = await signInAsNewOwner("Cora Closer", "cora@libsql.test");
    const company = await libsql.company.create({
      data: { name: "Gone Holdings", ownerId: user.id, workspaceId },
    });

    await expect(deleteCompany(company.id)).rejects.toThrow("NEXT_REDIRECT:/companies");

    expect(await libsql.company.count({ where: { id: company.id } })).toBe(0);
    const entry = await libsql.auditLog.findFirstOrThrow({
      where: { action: "company.delete", entityId: company.id },
    });
    expect(entry).toMatchObject({ entityType: "company", userId: user.id, workspaceId });
    expect(JSON.parse(entry.metadata ?? "null")).toEqual({ name: "Gone Holdings" });
  }, 20_000);

  it("moveDeal inserts the card into another column, resequences it and audits the stage change", async () => {
    const { user, workspaceId } = await signInAsNewOwner("Mona Mover", "mona@libsql.test");
    const seed = async (stage: string, titles: string[]) => {
      const made = [];
      for (const [position, title] of titles.entries()) {
        made.push(
          await libsql.deal.create({
            data: { title, value: 100, baseValue: 100, stage, position, ownerId: user.id, workspaceId },
          }),
        );
      }
      return made;
    };
    const [moved] = await seed("LEAD", ["Move me", "Stay put"]);
    await seed("PROPOSAL", ["First", "Second"]);

    expect(await moveDeal({ dealId: moved!.id, stage: "PROPOSAL", position: 1 })).toEqual({ ok: true });

    const column = await libsql.deal.findMany({
      where: { workspaceId, stage: "PROPOSAL" },
      orderBy: { position: "asc" },
      select: { title: true, position: true },
    });
    expect(column).toEqual([
      { title: "First", position: 0 },
      { title: "Move me", position: 1 },
      { title: "Second", position: 2 },
    ]);
    expect(await libsql.deal.count({ where: { workspaceId, stage: "LEAD" } })).toBe(1);

    const entry = await libsql.auditLog.findFirstOrThrow({
      where: { action: "deal.stage_change", entityId: moved!.id },
    });
    expect(entry).toMatchObject({ entityType: "deal", userId: user.id, workspaceId });
    expect(JSON.parse(entry.metadata ?? "null")).toEqual({ from: "LEAD", to: "PROPOSAL", via: "kanban" });
  }, 20_000);
});

describe("Review Focus 2 across two clients on one file", () => {
  it("two first sign-ups racing through two PrismaLibSql clients leave one workspace and one OWNER", async () => {
    process.env.WORKSPACE_MODE = "single";
    // One source address for both: two attempts sit well inside the limit.
    request.ip = "10.41.0.1";
    gate.barrier = barrier(2);
    const entrants = [
      { client: racers[0], name: "Ada Racer", email: "ada@race.test" },
      { client: racers[1], name: "Grace Racer", email: "grace@race.test" },
    ];

    // A loser reports its failed transaction on the console (and to Sentry);
    // the report is part of the contract, so it is captured rather than printed.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const reported: unknown[][] = [];
    const outcomes = await Promise.all(
      entrants.map((e) => attempt(e.client, e.name, e.email)),
    ).finally(() => {
      process.env.WORKSPACE_MODE = "multi";
      gate.barrier = null;
      reported.push(...consoleError.mock.calls);
      consoleError.mockRestore();
    });

    const db = racers[0];
    // Whatever SQLite's locking decided, the install has one workspace and one owner.
    expect(await db.workspace.count()).toBe(1);
    expect(await db.membership.count({ where: { role: "OWNER" } })).toBe(1);

    // Each registrant either holds a membership, or was told to retry and left
    // no user, membership or workspace behind.
    const ends: string[] = [];
    for (const [i, outcome] of outcomes.entries()) {
      const user = await db.user.findUnique({
        where: { email: entrants[i]!.email },
        include: { membership: true },
      });
      if (outcome.signedIn) {
        expect(user?.membership, `${entrants[i]!.email} signed in without a membership`).toBeTruthy();
        ends.push(user!.membership!.role);
      } else {
        expect(outcome.state).toEqual({ message: SIGNUP_RETRY });
        expect(user).toBeNull();
        ends.push("retry");
      }
    }
    // One OWNER; the other registrant is a MEMBER or got the retry message.
    expect([
      ["MEMBER", "OWNER"],
      ["OWNER", "retry"],
    ]).toContainEqual(ends.sort());
    const signedIn = outcomes.filter((o) => o.signedIn).length;
    expect(await db.user.count()).toBe(signedIn);
    expect(await db.membership.count()).toBe(signedIn);
    // A retried sign-up was reported, and a clean one reported nothing.
    expect(reported.map(([message]) => message)).toEqual(
      Array<string>(outcomes.length - signedIn).fill("sign-up transaction failed"),
    );
  }, 30_000);
});
