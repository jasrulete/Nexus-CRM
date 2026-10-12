/**
 * Phase A's step 0 reads PRAGMA foreign_keys and the compile options through
 * the production adapter before anything else happens (spec §10). The script
 * is read-only; this runs it the way the runbook does, against a throwaway
 * local file instead of Turso.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/test/action-harness";

const { file, destroy } = createTestDatabase();

afterAll(async () => {
  await destroy();
});

describe("scripts/read-db-pragmas.ts", () => {
  it("reads foreign_keys five times and lists the compile options", () => {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/read-db-pragmas.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 90_000,
        env: {
          ...process.env,
          DATABASE_URL: `file:${file}`,
          // Whatever a developer's .env carries, this run stays on the throwaway
          // file: dotenv never overrides a variable that is already set, and it
          // treats a blank value as set, so the child never loads the remote
          // credentials.
          ALLOW_REMOTE_DB: "false",
          TURSO_DATABASE_URL: "",
          TURSO_AUTH_TOKEN: "",
        },
      },
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain("Reading pragmas from the local database (read-only).");
    expect(output.match(/^foreign_keys read [1-5]: [01]$/gm)).toHaveLength(5);
    expect(output).toMatch(/^compile_options \(\d+\):$/m);
  }, 90_000);
});
