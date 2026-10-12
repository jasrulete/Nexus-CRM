import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// Multi mode (spec §9.9) runs on a second server: its own port, its own
// database (migrated, never seeded), WORKSPACE_MODE=multi and DEMO_MODE off.
// It is a separate process, so it also has its own in-memory rate limiter and
// its sign-ups never count against the single server's register limit. It is
// always the built standalone server: Next 16 allows one `next dev` per
// directory, and the single-mode server already holds it. So it runs in CI,
// which builds first, and locally only when asked:
//   npm run build
//   $env:DATABASE_URL = "file:./e2e-multi.db"; npx prisma migrate deploy; $env:DATABASE_URL = $null
//   $env:E2E_MULTI = "1"; npm run test:e2e
// Clear DATABASE_URL after the migrate, as CI scopes it to that one command:
// the single-mode server inherits the shell's environment, and pointed at
// e2e-multi.db its boot check refuses that database's many workspaces.
// One build serves both servers: WORKSPACE_MODE is read at runtime, never inlined.
const multiBaseURL = process.env.E2E_MULTI_BASE_URL ?? "http://localhost:3100";
const runMulti = !!process.env.CI || process.env.E2E_MULTI === "1";
const MULTI_SPECS = /[\\/]multi-[^\\/]+\.spec\.ts$/;

// The AI tests assert UI behaviour — that a draft appears, that sending
// logs an activity — never the wording a model produced. Left to reach a
// real provider they inherit GEMINI_API_KEY from .env and fail whenever the
// free tier's 20-requests-per-day quota is spent, which has already made
// the suite flake. Blanking the keys puts the app in its own deterministic
// heuristic mode, which is a code path worth covering anyway, and removes a
// network round trip per test.
//
// Set E2E_LIVE_AI=1 to run the same suite against a real provider.
const aiEnv: Record<string, string> = process.env.E2E_LIVE_AI
  ? {}
  : { GEMINI_API_KEY: "", GROQ_API_KEY: "" };

// Both servers run on a local SQLite file, never the remote database. .env
// holds the production Turso credentials and the database adapter already
// ignores them unless ALLOW_REMOTE_DB=true, so this is a second lock: it
// blanks them (and the opt-in) for both servers, whatever the developer's
// shell or .env says. start-standalone.mjs and Next both load .env, and
// neither overwrites a variable that is already set, even to "".
const localDbEnv: Record<string, string> = {
  ALLOW_REMOTE_DB: "",
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // the suite shares one seeded SQLite database
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // Dev compiles each route on its first request, so a cold run overruns both
  // the 5s assertion and 30s per-test defaults — a test that signs in and then
  // visits two uncompiled routes spends most of its budget waiting on webpack.
  // CI serves a prebuilt app, so it keeps the defaults.
  expect: { timeout: process.env.CI ? 5_000 : 20_000 },
  timeout: process.env.CI ? 30_000 : 90_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", testIgnore: MULTI_SPECS, use: { ...devices["Desktop Chrome"] } },
    ...(runMulti
      ? [
          {
            name: "multi",
            testMatch: MULTI_SPECS,
            use: { ...devices["Desktop Chrome"], baseURL: multiBaseURL },
          },
        ]
      : []),
  ],
  webServer: [
    {
      // CI serves .next/standalone/server.js — the same artifact the Docker image
      // ships — so the suite covers what actually gets deployed. Locally, reuse
      // whatever dev server is up.
      command: process.env.CI ? "npm run start:standalone" : "npm run dev",
      // Readiness differs by mode because a different thing is slow in each.
      // CI serves a prebuilt app, so nothing compiles but the first DB-backed
      // request is cold — /api/health runs SELECT 1 and warms Prisma and the
      // SQLite driver before sign-in. Dev has the database ready but compiles
      // routes on demand, so waiting on "/" gets the app shell built instead.
      url: process.env.CI ? `${baseURL}/api/health` : baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...aiEnv, ...localDbEnv },
    },
    ...(runMulti
      ? [
          {
            command: "npm run start:standalone",
            url: `${multiBaseURL}/api/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
            env: {
              ...aiEnv,
              ...localDbEnv,
              PORT: new URL(multiBaseURL).port,
              WORKSPACE_MODE: "multi",
              // Empty rather than absent: start-standalone.mjs loads .env, and
              // dotenv never overwrites a variable that is already set.
              DEMO_MODE: "",
              DATABASE_URL: "file:./e2e-multi.db",
            },
          },
        ]
      : []),
  ],
});
