import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBootConfig, registerSubtitle, workspaceMode } from "./workspace-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workspaceMode", () => {
  it("reads both modes", () => {
    expect(workspaceMode({ WORKSPACE_MODE: "single" })).toBe("single");
    expect(workspaceMode({ WORKSPACE_MODE: "multi" })).toBe("multi");
    expect(workspaceMode({ WORKSPACE_MODE: "multi", NODE_ENV: "production" })).toBe("multi");
  });

  it("defaults to single outside production, treating an empty value as unset", () => {
    expect(workspaceMode({})).toBe("single");
    expect(workspaceMode({ NODE_ENV: "development" })).toBe("single");
    expect(workspaceMode({ NODE_ENV: "test", WORKSPACE_MODE: "" })).toBe("single");
  });

  it("fails in production when the variable is missing or empty", () => {
    // A cloud deployment that lost the variable must not silently become single.
    expect(() => workspaceMode({ NODE_ENV: "production" })).toThrow(
      "WORKSPACE_MODE is required in production",
    );
    expect(() => workspaceMode({ NODE_ENV: "production", WORKSPACE_MODE: "" })).toThrow(
      "WORKSPACE_MODE is required in production",
    );
  });

  // A value piped from PowerShell or the Vercel CLI can carry a trailing
  // newline or CR; the accepted values are still exactly single and multi.
  it("trims surrounding whitespace before reading the value", () => {
    expect(workspaceMode({ WORKSPACE_MODE: "single\r\n", NODE_ENV: "production" })).toBe("single");
    expect(workspaceMode({ WORKSPACE_MODE: " multi " })).toBe("multi");
  });

  it("treats a whitespace-only value as unset", () => {
    expect(workspaceMode({ WORKSPACE_MODE: " \r\n" })).toBe("single");
    expect(() => workspaceMode({ NODE_ENV: "production", WORKSPACE_MODE: "\r\n" })).toThrow(
      "WORKSPACE_MODE is required in production",
    );
  });

  it.each(["Single", "MULTI", "both", "sin gle", "true"])("rejects %j", (value) => {
    expect(() => workspaceMode({ WORKSPACE_MODE: value })).toThrow(
      "WORKSPACE_MODE must be 'single' or 'multi'",
    );
  });

  it("reads process.env when no env is passed", () => {
    vi.stubEnv("WORKSPACE_MODE", "multi");
    expect(workspaceMode()).toBe("multi");
  });
});

describe("assertBootConfig", () => {
  it("returns the mode for a valid configuration", () => {
    expect(assertBootConfig({ WORKSPACE_MODE: "single", DEMO_MODE: "true" })).toBe("single");
    expect(assertBootConfig({ WORKSPACE_MODE: "multi" })).toBe("multi");
  });

  it("refuses multi mode with DEMO_MODE on", () => {
    expect(() => assertBootConfig({ WORKSPACE_MODE: "multi", DEMO_MODE: "true" })).toThrow(
      "WORKSPACE_MODE=multi cannot run with DEMO_MODE=true",
    );
  });

  // The same piped-value hazard as WORKSPACE_MODE: read raw, "true\r\n" would
  // look off and let a multi deployment boot with the demo lock's flag set.
  it.each(["true\r\n", " true "])("reads DEMO_MODE %j as on", (value) => {
    expect(() => assertBootConfig({ WORKSPACE_MODE: "multi", DEMO_MODE: value })).toThrow(
      "WORKSPACE_MODE=multi cannot run with DEMO_MODE=true",
    );
    expect(assertBootConfig({ WORKSPACE_MODE: "single", DEMO_MODE: value })).toBe("single");
  });

  it.each(["TRUE", "1", " \r\n"])("still reads DEMO_MODE %j as off after trimming", (value) => {
    expect(assertBootConfig({ WORKSPACE_MODE: "multi", DEMO_MODE: value })).toBe("multi");
  });

  it("reads the trimmed value, so a piped newline neither fails boot nor hides multi", () => {
    expect(assertBootConfig({ WORKSPACE_MODE: "single\r\n", NODE_ENV: "production" })).toBe("single");
    expect(() => assertBootConfig({ WORKSPACE_MODE: " multi ", DEMO_MODE: "true" })).toThrow(
      "WORKSPACE_MODE=multi cannot run with DEMO_MODE=true",
    );
  });

  it("passes workspaceMode's own failures through", () => {
    expect(() => assertBootConfig({ NODE_ENV: "production" })).toThrow(
      "WORKSPACE_MODE is required in production",
    );
  });
});

describe("registerSubtitle", () => {
  it("keeps the shared-demo warning on the shared demo", () => {
    expect(registerSubtitle("single", true)).toBe("This is a public sandbox, not a private workspace.");
  });

  it("names the first account the owner in single mode", () => {
    expect(registerSubtitle("single", false)).toBe("The first account becomes the workspace owner.");
  });

  it("promises a private workspace in multi mode", () => {
    expect(registerSubtitle("multi", false)).toBe("Your account gets its own private workspace.");
  });
});
