/**
 * The login action against a real database. Faked: the request headers (so a
 * test can be a given source address), bcrypt (so forty attempts cost
 * milliseconds, and so a test can see whether the compare ran at all), the
 * session cookie, and Next's redirect. The rate limiter, zod, the audit log
 * and the user lookup run for real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, formData, makeUser, truncateAll } from "@/test/action-harness";

const { prisma, destroy } = createTestDatabase();
vi.mock("@/lib/db", () => ({ prisma }));

const request = vi.hoisted(() => ({ ip: "local" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": request.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: async () => {},
  destroySession: async () => {},
  getCurrentUser: async () => null,
}));

// bcrypt at cost 12 takes a quarter of a second, and forty of them would make
// this the slowest file in the suite. The stand-in also counts how often it
// ran, which is the whole point of a cap that sits in front of it.
const bcrypt = vi.hoisted(() => ({ compares: 0 }));
vi.mock("./password", () => ({
  hashPassword: async (password: string) => `hashed:${password}`,
  verifyPassword: async (password: string) => {
    bcrypt.compares += 1;
    return password === "correct horse";
  },
}));

const { login } = await import("./actions");

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});

let seq = 0;
beforeEach(async () => {
  await truncateAll(prisma);
  // The limiter keeps its buckets in module state, so every test gets its own
  // source address and its own emails, the way ai.test.ts gives every test its
  // own user.
  seq += 1;
  request.ip = `10.0.${seq}.1`;
  bcrypt.compares = 0;
});

const TOO_MANY = /too many attempts/i;
const WRONG = /invalid email or password/i;

async function attempt(email: string, password: string) {
  try {
    const state = await login({}, formData({ email, password }));
    return { signedIn: false, message: state.message ?? "" };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      return { signedIn: true, message: "" };
    }
    throw error;
  }
}
const failedLogins = () => prisma.auditLog.count({ where: { action: "auth.login_failed" } });

// One address sending a fresh email with every request used to pass every
// check the login had, because the only address-keyed bucket also carried
// the email: each request forced a bcrypt compare, and the comment above the
// buckets promised a per-source control that did not exist.
describe("login, per source", () => {
  it("refuses the forty-first attempt from one source, whatever email it tries, before the lookup and the compare", async () => {
    for (let i = 0; i < 40; i++) {
      expect((await attempt(`guess${seq}-${i}@example.com`, "not it")).message).toMatch(WRONG);
    }
    expect(bcrypt.compares).toBe(40);
    expect(await failedLogins()).toBe(40);

    const refused = await attempt(`guess${seq}-41@example.com`, "not it");

    expect(refused.message).toMatch(TOO_MANY);
    expect(bcrypt.compares).toBe(40);
    expect(await failedLogins()).toBe(40);
  });

  it("leaves another source untouched by an exhausted one", async () => {
    for (let i = 0; i < 41; i++) await attempt(`spray${seq}-${i}@example.com`, "not it");
    expect((await attempt(`spray${seq}-x@example.com`, "not it")).message).toMatch(TOO_MANY);

    request.ip = `10.0.${seq}.2`;

    expect((await attempt(`spray${seq}-y@example.com`, "not it")).message).toMatch(WRONG);
  });

  it("counts successful sign-ins toward the per-source cap but not toward the account's", async () => {
    const user = await makeUser(prisma, { email: `owner${seq}@example.com` });
    for (let i = 0; i < 40; i++) {
      expect((await attempt(user.email, "correct horse")).signedIn).toBe(true);
    }

    const refused = await attempt(user.email, "correct horse");

    expect(refused.signedIn).toBe(false);
    expect(refused.message).toMatch(TOO_MANY);
    // The account bucket counts failures only, so the same account signs in
    // from elsewhere: the shared demo account cannot be locked by its visitors.
    request.ip = `10.0.${seq}.2`;
    expect((await attempt(user.email, "correct horse")).signedIn).toBe(true);
  });
});

describe("login, per source and email, and per account", () => {
  it("refuses the eleventh failure for one email from one source while other emails get through", async () => {
    const email = `target${seq}@example.com`;
    for (let i = 0; i < 10; i++) {
      expect((await attempt(email, "not it")).message).toMatch(WRONG);
    }

    expect((await attempt(email, "not it")).message).toMatch(TOO_MANY);
    expect((await attempt(`other${seq}@example.com`, "not it")).message).toMatch(WRONG);
  });

  it("refuses the twenty-first failure for one account from any source", async () => {
    const email = `account${seq}@example.com`;
    for (let i = 0; i < 20; i++) {
      request.ip = `10.${seq}.${i}.1`;
      expect((await attempt(email, "not it")).message).toMatch(WRONG);
    }

    request.ip = `10.${seq}.99.1`;

    expect((await attempt(email, "not it")).message).toMatch(TOO_MANY);
  });
});
