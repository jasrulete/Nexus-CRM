/**
 * register() in both modes, against a real database (spec §6, §9.5).
 *
 * Faked: the request headers (each test is its own source address, because the
 * register limiter keeps its buckets in module state), bcrypt, the session
 * cookie and Next's redirect. The transaction, the bootstrap, the limiter and
 * the platform audit row run for real.
 *
 * Review Focus 2: two sign-ups racing on a fresh single-mode install end with
 * exactly one workspace and exactly one OWNER; the other registrant is MEMBER.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, formData, makeWorkspace, truncateAll } from "@/test/action-harness";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workspace-bootstrap";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
    scopeToWorkspace,
    forWorkspace: (ws: string) => scopeToWorkspace(prisma, ws),
  };
});

const request = vi.hoisted(() => ({ ip: "local" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": request.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));

const trace = vi.hoisted(() => ({
  order: [] as string[],
  sessions: [] as string[],
  // When set, every hashPassword call waits here until all expected callers
  // arrive, so concurrent sign-ups have all passed the email pre-check before
  // any transaction starts.
  barrier: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: async (userId: string) => {
    trace.order.push("session");
    trace.sessions.push(userId);
  },
  destroySession: async () => {},
  getCurrentUser: async () => null,
}));
vi.mock("./password", () => ({
  hashPassword: async (password: string) => {
    await trace.barrier?.();
    trace.order.push("hash");
    return `hashed:${password}`;
  },
  verifyPassword: async () => false,
}));

const { register } = await import("./actions");

afterAll(async () => {
  await destroy();
});

let seq = 0;
beforeEach(async () => {
  await truncateAll(prisma);
  seq += 1;
  request.ip = `10.1.${seq}.1`;
  trace.order = [];
  trace.sessions = [];
  trace.barrier = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

/** Runs register and reports how it ended. */
async function signUp(name: string, email: string) {
  try {
    const state = await register({}, formData({ name, email, password: "long enough password" }));
    return { signedIn: false, state };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT:/dashboard") {
      return { signedIn: true, state: {} };
    }
    throw error;
  }
}

async function membershipOf(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
}

describe("register, single mode", () => {
  beforeEach(() => {
    vi.stubEnv("WORKSPACE_MODE", "single");
  });

  it("makes the first registrant OWNER of the default workspace", async () => {
    expect((await signUp("Ada Lovelace", "ada@example.com")).signedIn).toBe(true);

    expect(await prisma.workspace.findMany({ select: { id: true } })).toEqual([{ id: DEFAULT_WORKSPACE_ID }]);
    expect(await membershipOf("ada@example.com")).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, role: "OWNER" });
  });

  it("makes later registrants MEMBERs of the same workspace", async () => {
    await signUp("Ada Lovelace", "ada@example.com");
    await signUp("Grace Hopper", "grace@example.com");

    expect(await prisma.workspace.count()).toBe(1);
    expect(await membershipOf("grace@example.com")).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, role: "MEMBER" });
  });

  it("joins an existing install's workspace as MEMBER", async () => {
    await makeWorkspace(prisma, { id: "ws_existing", slug: "existing" });
    await prisma.user.create({ data: { email: "old@example.com", name: "Old", passwordHash: "x" } });
    const old = await prisma.user.findUniqueOrThrow({ where: { email: "old@example.com" } });
    await prisma.membership.create({ data: { workspaceId: "ws_existing", userId: old.id, role: "ADMIN" } });

    await signUp("New Person", "new@example.com");

    expect(await membershipOf("new@example.com")).toMatchObject({ workspaceId: "ws_existing", role: "MEMBER" });
  });

  it("gives exactly one OWNER and one workspace when two first sign-ups race", async () => {
    trace.barrier = barrier(2);

    const results = await Promise.all([
      signUp("Ada Lovelace", "ada@example.com"),
      signUp("Grace Hopper", "grace@example.com"),
    ]);

    expect(results.map((r) => r.signedIn)).toEqual([true, true]);
    expect(await prisma.workspace.count()).toBe(1);
    const roles = (await prisma.membership.findMany({ where: { workspaceId: DEFAULT_WORKSPACE_ID } }))
      .map((m) => m.role)
      .sort();
    expect(roles).toEqual(["MEMBER", "OWNER"]);
  });

  it("refuses when the database has two workspaces, and rolls the user back", async () => {
    await makeWorkspace(prisma, { id: "ws_1" });
    await makeWorkspace(prisma, { id: "ws_2" });

    await expect(signUp("Ada Lovelace", "ada@example.com")).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
    expect(trace.sessions).toEqual([]);
  });

  it("refuses when the one workspace is PAID", async () => {
    await makeWorkspace(prisma, { id: "ws_paid", plan: "PAID" });

    await expect(signUp("Ada Lovelace", "ada@example.com")).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
    expect(await prisma.user.count()).toBe(0);
  });
});

describe("register, multi mode", () => {
  beforeEach(() => {
    vi.stubEnv("WORKSPACE_MODE", "multi");
  });

  it("creates the user, a private workspace and an OWNER membership", async () => {
    expect((await signUp("Ada Lovelace", "ada@example.com")).signedIn).toBe(true);

    const membership = await membershipOf("ada@example.com");
    expect(membership.role).toBe("OWNER");
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: membership.workspaceId } });
    expect(workspace).toMatchObject({ name: "Ada Lovelace's workspace", plan: "FREE", isDemo: false });
    expect(workspace.slug).toMatch(/^ada-lovelace-[0-9a-f]{8}$/);
  });

  it("gives every sign-up its own workspace, never an existing one", async () => {
    await makeWorkspace(prisma, { id: DEFAULT_WORKSPACE_ID, slug: "default" });

    await signUp("Ada Lovelace", "ada@example.com");
    await signUp("Ada Lovelace", "ada2@example.com");

    const ada = await membershipOf("ada@example.com");
    const ada2 = await membershipOf("ada2@example.com");
    expect(new Set([ada.workspaceId, ada2.workspaceId, DEFAULT_WORKSPACE_ID]).size).toBe(3);
    expect([ada.role, ada2.role]).toEqual(["OWNER", "OWNER"]);
    expect(await prisma.membership.count({ where: { workspaceId: DEFAULT_WORKSPACE_ID } })).toBe(0);
  });

  it("slugs a name with no ASCII letters", async () => {
    await signUp("李雷 李雷", "li@example.com");

    const { workspaceId } = await membershipOf("li@example.com");
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).slug).toMatch(
      /^workspace-[0-9a-f]{8}$/,
    );
  });

  it("is atomic: a sign-up that loses an email race leaves no workspace behind", async () => {
    // Both pass the email pre-check before either transaction runs, so the
    // loser's transaction creates its workspace and then fails on the email.
    trace.barrier = barrier(2);

    const results = await Promise.all([
      signUp("Ada Lovelace", "ada@example.com"),
      signUp("Ada Impostor", "ada@example.com"),
    ]);

    expect(results.filter((r) => r.signedIn)).toHaveLength(1);
    expect(results.find((r) => !r.signedIn)?.state).toEqual({
      errors: { email: "This email is already registered" },
    });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.workspace.count()).toBe(1);
    expect(await prisma.membership.count()).toBe(1);
  });
});

describe("register, either mode", () => {
  it("refuses an email that is already registered", async () => {
    await signUp("Ada Lovelace", "ada@example.com");

    expect((await signUp("Ada Again", "ada@example.com")).state).toEqual({
      errors: { email: "This email is already registered" },
    });
  });

  it("hashes before the transaction, then writes the audit row and the session after commit", async () => {
    const realTransaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation((async (fn: unknown) => {
      trace.order.push("tx:start");
      const result = await realTransaction(fn as never);
      trace.order.push("tx:commit");
      return result;
    }) as never);
    const realCreate = prisma.auditLog.create.bind(prisma.auditLog);
    vi.spyOn(prisma.auditLog, "create").mockImplementation(((args: never) => {
      trace.order.push("audit");
      return realCreate(args);
    }) as never);

    await signUp("Ada Lovelace", "ada@example.com");

    expect(trace.order).toEqual(["hash", "tx:start", "tx:commit", "audit", "session"]);
  });

  it("records auth.register as a platform row with no workspace", async () => {
    await signUp("Ada Lovelace", "ada@example.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });

    expect(await prisma.auditLog.findMany()).toEqual([
      expect.objectContaining({ action: "auth.register", entityId: user.id, userId: user.id, workspaceId: null }),
    ]);
    expect(trace.sessions).toEqual([user.id]);
  });

  it("never writes the deprecated User.role", async () => {
    await signUp("Ada Lovelace", "ada@example.com");

    // The column keeps its schema default; the membership role is the one read.
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.com" } })).role).toBe("MEMBER");
  });

  it.each(["single", "multi"])(
    "%s mode: a failed transaction answers with a retry message and leaves nothing behind",
    async (mode) => {
      vi.stubEnv("WORKSPACE_MODE", mode);
      // What two serverless instances racing on Turso look like: the writes run,
      // then the commit fails. The real transaction rolls them back.
      const busy = Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" });
      const realTransaction = prisma.$transaction.bind(prisma);
      vi.spyOn(prisma, "$transaction").mockImplementation((async (fn: (tx: never) => Promise<unknown>) =>
        realTransaction(async (tx) => {
          await fn(tx as never);
          throw busy;
        })) as never);
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await signUp("Ada Lovelace", "ada@example.com")).toEqual({
        signedIn: false,
        state: { message: "Sign-up could not complete. Please try again." },
      });

      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.workspace.count()).toBe(0);
      expect(await prisma.membership.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
      expect(trace.sessions).toEqual([]);
      expect(logged).toHaveBeenCalledWith("sign-up transaction failed", busy);
    },
  );
});
