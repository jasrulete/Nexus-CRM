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

const shots = [
  { route: "/dashboard", file: "dashboard-dark.png" },
  { route: "/deals", file: "pipeline-dark.png" },
];

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });

  // theme-init.js reads this before hydration, so the app renders dark from
  // the first paint rather than flashing light.
  await context.addInitScript(() => {
    localStorage.setItem("theme", "dark");
  });

  // Dev compiles each route on its first request, which overruns Playwright's
  // 30s navigation default on a cold server.
  context.setDefaultNavigationTimeout(120_000);
  context.setDefaultTimeout(120_000);

  const page = await context.newPage();

  await page.goto(`${baseURL}/login`);
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.waitForURL(/\/dashboard$/);

  for (const shot of shots) {
    await page.goto(`${baseURL}${shot.route}`);
    await page.waitForLoadState("networkidle");
    // Recharts and the kanban settle after mount; capture once they have.
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: path.join(outDir, shot.file) });
    console.log(`captured ${shot.file}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
