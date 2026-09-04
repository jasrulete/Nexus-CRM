import { afterEach, describe, expect, it } from "vitest";

import {
  DEMO_EMAIL,
  assertNotLockedDemoAccount,
  isLockedDemoAccount,
  isSharedDemoInstance,
} from "./demo-guard";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

const demo = { email: DEMO_EMAIL };
const real = { email: "someone@example.com" };

describe("demo guard", () => {
  it("locks the demo account when DEMO_MODE is on", () => {
    process.env.DEMO_MODE = "true";

    expect(isLockedDemoAccount(demo)).toBe(true);
    expect(() => assertNotLockedDemoAccount(demo)).toThrow(/DEMO_READONLY/);
  });

  it("leaves other accounts alone in the same deployment", () => {
    process.env.DEMO_MODE = "true";

    expect(isLockedDemoAccount(real)).toBe(false);
    expect(() => assertNotLockedDemoAccount(real)).not.toThrow();
  });

  it("does not lock anyone when DEMO_MODE is unset", () => {
    // A self-hosted instance seeded with the same demo account must keep
    // full control of its own data.
    delete process.env.DEMO_MODE;

    expect(isLockedDemoAccount(demo)).toBe(false);
    expect(() => assertNotLockedDemoAccount(demo)).not.toThrow();
  });

  it("treats any value other than \"true\" as off", () => {
    process.env.DEMO_MODE = "1";

    expect(isLockedDemoAccount(demo)).toBe(false);
  });
});

describe("isSharedDemoInstance", () => {
  it("is true only on the deployment whose credentials are published", () => {
    process.env.DEMO_MODE = "true";

    expect(isSharedDemoInstance()).toBe(true);
  });

  it("is false for a private install, so the sign-up copy stays unqualified", () => {
    // A self-hoster gets the plain "create your workspace" promise, because on
    // their instance it is true.
    delete process.env.DEMO_MODE;

    expect(isSharedDemoInstance()).toBe(false);
  });

  it("treats any value other than \"true\" as off, like its sibling", () => {
    process.env.DEMO_MODE = "1";

    expect(isSharedDemoInstance()).toBe(false);
  });
});
