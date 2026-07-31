import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI exercises the production build; locally reuse whatever dev server is up.
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
