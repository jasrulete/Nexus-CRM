/**
 * Which kind of deployment this is (spec §6).
 *
 *  - `single`: self-host and the public demo. Exactly one workspace, and every
 *    registrant joins it.
 *  - `multi`: the paid cloud. Every sign-up gets a private workspace.
 *
 * Read at runtime from the environment, never inlined at build time, so one
 * build serves both modes. This module has no `server-only` and no `next/*`
 * imports: the seed, the demo reset, `tsx` scripts and the Docker esbuild
 * bundle all import it.
 */
export type WorkspaceMode = "single" | "multi";

type Env = Record<string, string | undefined>;

export function workspaceMode(env: Env = process.env): WorkspaceMode {
  // Trimmed: a value piped from PowerShell or the Vercel CLI can carry a
  // trailing newline or CR. The accepted values are still exactly the two.
  const value = env.WORKSPACE_MODE?.trim();
  // An empty value counts as unset, so a blank `WORKSPACE_MODE=` line in an
  // .env file behaves like a missing one: single in development, a hard
  // failure in production.
  if (value === undefined || value === "") {
    // A cloud deployment that lost the variable must not quietly become a
    // single-workspace install that puts every sign-up in one workspace.
    if (env.NODE_ENV === "production") {
      throw new Error("WORKSPACE_MODE is required in production");
    }
    return "single";
  }
  if (value === "single" || value === "multi") return value;
  throw new Error("WORKSPACE_MODE must be 'single' or 'multi'");
}

/**
 * The mode, plus the combinations that must never boot. Called first thing in
 * instrumentation's `register()`.
 */
export function assertBootConfig(env: Env = process.env): WorkspaceMode {
  const mode = workspaceMode(env);
  // DEMO_MODE turns on the shared-sandbox behaviour (the locked demo account,
  // the delete guard). A paid cloud deployment must never run it.
  if (mode === "multi" && env.DEMO_MODE === "true") {
    throw new Error("WORKSPACE_MODE=multi cannot run with DEMO_MODE=true");
  }
  return mode;
}

/**
 * The line under the sign-up heading. On the shared demo it warns that nothing
 * there is private. Otherwise it says where the new account lands, which
 * depends on the mode.
 */
export function registerSubtitle(mode: WorkspaceMode, sharedDemo: boolean): string {
  if (sharedDemo) return "This is a public sandbox, not a private workspace.";
  return mode === "multi"
    ? "Your account gets its own private workspace."
    : "The first account becomes the workspace owner.";
}
