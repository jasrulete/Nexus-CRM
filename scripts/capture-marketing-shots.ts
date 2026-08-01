/**
 * Captures the product screenshots used by the landing page hero.
 *
 * Needs a running server with a seeded demo user:
 *   npm run dev            (in another terminal)
 *   npm run capture:shots
 *
 * Output is committed to public/marketing/, so builds and deploys never
 * depend on this script — rerun it only when the UI changes.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const outDir = path.join(process.cwd(), "public", "marketing");

const routes = [
  { route: "/dashboard", name: "dashboard" },
  { route: "/deals", name: "pipeline" },
];

const themes = ["light", "dark"] as const;

async function captureTheme(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  theme: (typeof themes)[number],
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });

  // theme-init.js reads this before hydration, so the app renders in the right
  // theme from the first paint rather than flashing the other one.
  await context.addInitScript((t) => {
    localStorage.setItem("theme", t);
  }, theme);

  // Dev compiles each route on its first request, which overruns Playwright's
  // 30s navigation default on a cold server.
  context.setDefaultNavigationTimeout(120_000);
  context.setDefaultTimeout(120_000);

  const page = await context.newPage();

  await page.goto(`${baseURL}/login`);
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.waitForURL(/\/dashboard$/);

  for (const { route, name } of routes) {
    await page.goto(`${baseURL}${route}`);
    await page.waitForLoadState("networkidle");
    // Recharts and the kanban settle after mount; capture once they have.
    await page.waitForTimeout(1_500);
    const file = `${name}-${theme}.png`;
    await page.screenshot({ path: path.join(outDir, file) });
    console.log(`captured ${file}`);
  }

  await context.close();
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  for (const theme of themes) {
    await captureTheme(browser, theme);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
