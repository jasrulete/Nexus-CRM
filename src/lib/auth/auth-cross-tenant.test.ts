/**
 * Cross-tenant cases for the auth actions (spec §9.1). Workspace A's owner acts;
 * workspace B must come out byte-for-byte unchanged.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, formData, truncateAll } from "@/test/action-harness";
import {
  registerCrossTenantCase,
  snapshotWorkspace,
  twoWorkspaces,
  type TenantFixture,
} from "@/test/cross-tenant";

registerCrossTenantCase("src/lib/auth/actions.ts#login");
registerCrossTenantCase("src/lib/auth/actions.ts#logout");

const { prisma, destroy } = createTestDatabase();

vi.mock("@/lib/db", async () => {
  const { scopeToWorkspace } = await import("@/lib/tenancy");
  return {
    systemDb: prisma,
    prisma,
    scopeToWorkspace,
    forWorkspace: (ws: string) => scopeToWorkspace(prisma, ws),
  };
});

const request = vi.hoisted(() => ({ ip: "10.9.0.1" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": request.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
  created: [] as string[],
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: async (userId: string) => {
    session.created.push(userId);
  },
  destroySession: async () => {},
  getCurrentUser: async () => session.user,
}));

vi.mock("./password", () => ({
  hashPassword: async (password: string) => `hashed:${password}`,
  verifyPassword: async (password: string) => password === "correct horse",
}));

const { login, logout } = await import("./actions");

afterAll(async () => {
  await destroy();
});

let a: TenantFixture;
let b: TenantFixture;
let seq = 0;

beforeEach(async () => {
  await truncateAll(prisma);
  ({ a, b } = await twoWorkspaces(prisma));
  seq += 1;
  request.ip = `10.9.${seq}.1`;
  session.user = null;
  session.created = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cross-tenant: auth actions", () => {
  it("login as A's owner signs in A's owner and leaves B unchanged", async () => {
    const before = await snapshotWorkspace(prisma, b.workspaceId);

    await expect(login({}, formData({ email: a.owner.email, password: "correct horse" }))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );

    expect(session.created).toEqual([a.owner.id]);
    expect(await snapshotWorkspace(prisma, b.workspaceId)).toBe(before);
  });

  it("a failed login for B's owner from A's side writes nothing into B", async () => {
    const before = await snapshotWorkspace(prisma, b.workspaceId);

    const state = await login({}, formData({ email: b.owner.email, password: "not it" }));

    expect(state.message).toMatch(/invalid email or password/i);
    expect(await snapshotWorkspace(prisma, b.workspaceId)).toBe(before);
  });

  it("logout as A's owner leaves B unchanged", async () => {
    session.user = a.owner;
    const before = await snapshotWorkspace(prisma, b.workspaceId);

    await expect(logout()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(await snapshotWorkspace(prisma, b.workspaceId)).toBe(before);
  });
});
