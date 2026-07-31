import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDbAdapter } from "./db-adapter";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

function env(vars: Record<string, string | undefined>) {
  // .env is loaded for the test run, so unset explicitly rather than assuming.
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("createDbAdapter", () => {
  it("ignores a Turso URL on a developer machine", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    env({
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      DATABASE_URL: "file::memory:",
      VERCEL: undefined,
      ALLOW_REMOTE_DB: undefined,
    });

    // The regression this guards: `next dev` and the e2e suite reaching
    // production because a real .env carries TURSO_DATABASE_URL.
    expect(createDbAdapter()).toBeInstanceOf(PrismaBetterSqlite3);
  });

  it("uses Turso when explicitly allowed", () => {
    env({
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      ALLOW_REMOTE_DB: "true",
      VERCEL: undefined,
    });

    expect(createDbAdapter()).toBeInstanceOf(PrismaLibSql);
  });

  it("uses Turso on Vercel without an opt-in flag", () => {
    env({
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      VERCEL: "1",
      ALLOW_REMOTE_DB: undefined,
    });

    expect(createDbAdapter()).toBeInstanceOf(PrismaLibSql);
  });

  it("fails fast on Vercel when no Turso URL is configured", () => {
    env({
      TURSO_DATABASE_URL: undefined,
      VERCEL: "1",
      ALLOW_REMOTE_DB: undefined,
    });

    expect(() => createDbAdapter()).toThrow(/TURSO_DATABASE_URL is required/);
  });
});
