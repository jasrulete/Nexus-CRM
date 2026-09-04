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
      VERCEL_ENV: undefined,
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

  it("uses Turso on a Vercel production deployment without an opt-in flag", () => {
    env({
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      VERCEL: "1",
      VERCEL_ENV: "production",
      ALLOW_REMOTE_DB: undefined,
    });

    expect(createDbAdapter()).toBeInstanceOf(PrismaLibSql);
  });

  it.each(["preview", "development"])(
    "refuses the production database on a Vercel %s deployment",
    (vercelEnv) => {
      env({
        TURSO_DATABASE_URL: "libsql://example.turso.io",
        VERCEL: "1",
        VERCEL_ENV: vercelEnv,
        ALLOW_REMOTE_DB: undefined,
      });

      // The regression this guards: VERCEL is "1" on every deployment, so
      // testing it pointed all ten feature-branch previews at production —
      // where DEMO_MODE is unset, so the delete guard is inert too.
      expect(() => createDbAdapter()).toThrow(
        /will not use the production database/,
      );
    },
  );

  it("still allows a preview deployment its own database when opted in", () => {
    env({
      TURSO_DATABASE_URL: "libsql://preview.turso.io",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      ALLOW_REMOTE_DB: "true",
    });

    expect(createDbAdapter()).toBeInstanceOf(PrismaLibSql);
  });

  it("fails closed on Vercel when VERCEL_ENV is missing entirely", () => {
    env({
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      VERCEL: "1",
      VERCEL_ENV: undefined,
      ALLOW_REMOTE_DB: undefined,
    });

    expect(() => createDbAdapter()).toThrow(
      /will not use the production database/,
    );
  });

  it("ignores VERCEL_ENV=production on a developer machine", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    env({
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      DATABASE_URL: "file::memory:",
      VERCEL: undefined,
      // `vercel env pull --environment=production` writes this into .env, and
      // dotenv loads it — it must not by itself unlock the production database.
      VERCEL_ENV: "production",
      ALLOW_REMOTE_DB: undefined,
    });

    expect(createDbAdapter()).toBeInstanceOf(PrismaBetterSqlite3);
    expect(warn).toHaveBeenCalled();
  });

  it("does not claim to use the local database on the Vercel throw path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    env({
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      ALLOW_REMOTE_DB: undefined,
    });

    expect(() => createDbAdapter()).toThrow();
    // The warning advises setting ALLOW_REMOTE_DB to reach "the remote one",
    // which on Vercel is production — it must not accompany this failure.
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails fast on Vercel production when no Turso URL is configured", () => {
    env({
      TURSO_DATABASE_URL: undefined,
      VERCEL: "1",
      VERCEL_ENV: "production",
      ALLOW_REMOTE_DB: undefined,
    });

    expect(() => createDbAdapter()).toThrow(/TURSO_DATABASE_URL is required/);
  });
});
