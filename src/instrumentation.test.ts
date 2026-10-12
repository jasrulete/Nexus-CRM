import { afterEach, describe, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => ({ check: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ assertSingleModeBoot: boot.check }));

const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ init: sentry.init, captureRequestError: vi.fn() }));
// A getter, so a test can turn Sentry off: register() reads the live binding.
const sentryOptions = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/sentry-options", () => ({
  get sentryEnabled() {
    return sentryOptions.enabled;
  },
  sharedSentryOptions: {},
}));

const { register } = await import("./instrumentation");

afterEach(() => {
  sentryOptions.enabled = true;
  vi.unstubAllEnvs();
  boot.check.mockReset();
  boot.check.mockResolvedValue(undefined);
  sentry.init.mockClear();
});

describe("instrumentation register()", () => {
  it("refuses to boot in production without WORKSPACE_MODE, before anything else runs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKSPACE_MODE", "");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await expect(register()).rejects.toThrow("WORKSPACE_MODE is required in production");
    expect(boot.check).not.toHaveBeenCalled();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("refuses to boot in multi mode with DEMO_MODE on", async () => {
    vi.stubEnv("WORKSPACE_MODE", "multi");
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await expect(register()).rejects.toThrow("WORKSPACE_MODE=multi cannot run with DEMO_MODE=true");
  });

  it("checks the database in single mode on the Node runtime", async () => {
    vi.stubEnv("WORKSPACE_MODE", "single");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();

    expect(boot.check).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("fails boot when the single-mode database check fails", async () => {
    vi.stubEnv("WORKSPACE_MODE", "single");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    boot.check.mockRejectedValue(new Error("SINGLE_MODE_VIOLATION: more than one workspace exists"));

    await expect(register()).rejects.toThrow(/^SINGLE_MODE_VIOLATION/);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  // Spec §6: the check is the top of register(), before any early return, so a
  // deployment without Sentry (the self-host default) is guarded the same way.
  it("still refuses a bad configuration when Sentry is disabled", async () => {
    sentryOptions.enabled = false;
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKSPACE_MODE", "");
    await expect(register()).rejects.toThrow("WORKSPACE_MODE is required in production");

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WORKSPACE_MODE", "multi");
    vi.stubEnv("DEMO_MODE", "true");
    await expect(register()).rejects.toThrow("WORKSPACE_MODE=multi cannot run with DEMO_MODE=true");

    expect(boot.check).not.toHaveBeenCalled();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("still checks the database in single mode when Sentry is disabled", async () => {
    sentryOptions.enabled = false;
    vi.stubEnv("WORKSPACE_MODE", "single");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    await register();

    expect(boot.check).toHaveBeenCalledTimes(1);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("skips the database check in multi mode and on the edge runtime", async () => {
    vi.stubEnv("WORKSPACE_MODE", "multi");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();

    vi.stubEnv("WORKSPACE_MODE", "single");
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();

    expect(boot.check).not.toHaveBeenCalled();
    expect(sentry.init).toHaveBeenCalledTimes(2);
  });
});
