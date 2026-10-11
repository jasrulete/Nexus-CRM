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

  it.each(["Single", "MULTI", "both", " single", "true"])("rejects %j", (value) => {
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
