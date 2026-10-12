/**
 * The route that breaks the stale-session loop (spec §5.3, Review Focus 1).
 * The session-cookie functions, the request's cookies and Next's redirect are
 * faked; the membership lookup runs against a real database.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/session-constants";
import { createTestDatabase, makeUser, truncateAll } from "@/test/action-harness";

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
    scopeToWorkspace,
    forWorkspace: (ws: string) => scopeToWorkspace(prisma, ws),
  };
});

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  /** Whether the request carries the session cookie. */
  cookie: false,
  destroyed: 0,
}));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
  destroySession: async () => {
    session.destroyed += 1;
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ has: (name: string) => session.cookie && name === SESSION_COOKIE }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

const { GET } = await import("./route");

afterAll(async () => {
  await destroy();
});

beforeEach(async () => {
  await truncateAll(prisma);
  session.user = null;
  session.cookie = false;
  session.destroyed = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function orphan() {
  return prisma.user.create({
    data: { email: "orphan@example.com", name: "Orphan", passwordHash: "not-a-real-hash" },
  });
}

describe("GET /auth/signout-stale", () => {
  it("clears a stale cookie and lands on /login", async () => {
    session.cookie = true;

    await expect(GET()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(session.destroyed).toBe(1);
  });

  // Nothing to clear, so no deletion Set-Cookie either: a cross-site request
  // to this URL cannot even send a cookie change.
  it("sends a request with no session cookie to /login without clearing anything", async () => {
    await expect(GET()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(session.destroyed).toBe(0);
  });

  it("signs out a multi-mode user with no membership", async () => {
    vi.stubEnv("WORKSPACE_MODE", "multi");
    session.cookie = true;
    session.user = await orphan();

    await expect(GET()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(session.destroyed).toBe(1);
  });

  it("leaves a healthy session alone, so a link elsewhere cannot sign anyone out", async () => {
    vi.stubEnv("WORKSPACE_MODE", "multi");
    session.user = await makeUser(prisma, { email: "member@example.com" });

    await expect(GET()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(session.destroyed).toBe(0);
  });

  it("sends a single-mode user with no membership on to be joined", async () => {
    vi.stubEnv("WORKSPACE_MODE", "single");
    session.user = await orphan();

    await expect(GET()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(session.destroyed).toBe(0);
  });
});
