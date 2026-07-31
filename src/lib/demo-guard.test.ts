import { afterEach, describe, expect, it } from "vitest";

import {
  DEMO_EMAIL,
  assertNotLockedDemoAccount,
  isLockedDemoAccount,
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
