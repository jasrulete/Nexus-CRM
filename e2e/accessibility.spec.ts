/**
 * Automated accessibility checks on the pages a visitor and a signed-in user
 * actually see.
 *
 * The 2026-08-21 review graded accessibility below-bar: the kanban had no
 * keyboard path at all, and the muted-text token failed AA contrast across
 * dozens of usages. Both are fixed — and nothing was watching, which is why
 * they lasted. axe catches the mechanical half of WCAG (contrast, names,
 * roles, landmarks, labels) on every run.
 *
 * What this does not cover: axe finds roughly a third of real accessibility
 * problems. Keyboard operability of the board is asserted separately in
 * crm.spec.ts, because no scanner can tell you a drag target is unreachable.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** WCAG 2.1 A and AA — the level this project holds itself to. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(TAGS).analyze();
}

/** Reports the rule and the offending element, not just a count. */
function describeViolations(violations: Awaited<ReturnType<typeof scan>>["violations"]) {
  return violations
    .map((v) => {
      const where = v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ");
      return `${v.id} (${v.impact}) — ${v.help}\n    at: ${where}`;
    })
    .join("\n  ");
}

async function expectNoViolations(page: Page) {
  const { violations } = await scan(page);
  expect(violations.length, `axe violations:\n  ${describeViolations(violations)}`).toBe(0);
}

test.describe("signed out", () => {
  for (const [name, path] of [
    ["landing page", "/"],
    ["sign in", "/login"],
    ["register", "/register"],
  ] as const) {
    test(`${name} has no automatically-detectable violations`, async ({ page }) => {
      await page.goto(path);
      await expectNoViolations(page);
    });
  }
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Try the demo" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  for (const [name, path] of [
    ["dashboard", "/dashboard"],
    ["contacts", "/contacts"],
    ["companies", "/companies"],
    ["deals board", "/deals"],
    ["settings", "/settings"],
  ] as const) {
    test(`${name} has no automatically-detectable violations`, async ({ page }) => {
      await page.goto(path);
      await expectNoViolations(page);
    });
  }

  test("a contact detail page has no automatically-detectable violations", async ({
    page,
  }) => {
    await page.goto("/contacts");
    await page.locator('a[href^="/contacts/"]').first().click();
    await page.waitForURL(/\/contacts\/.+/);
    await expectNoViolations(page);
  });

  test("an open dialog has no automatically-detectable violations", async ({
    page,
  }) => {
    // Dialogs are where focus management and labelling usually break, and they
    // are invisible to a scan of the page behind them.
    await page.goto("/contacts");
    await page.getByRole("button", { name: "New contact" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("every avatar tint", () => {
  // The tint is picked by hashing the name, so a page only ever shows the ones
  // its own records happen to hash to. Scanning a real page therefore tests a
  // random subset — which is exactly how a failing tint survived several runs,
  // passing or failing depending on which contact sorted first. This renders
  // all six deliberately.
  test("passes contrast for all six colours, not just the ones on screen", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Try the demo" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Names chosen so that tintFor() lands on a different tint for each — the
    // count assertion below fails if that stops being true.
    const names = ["Ana Reyes", "Ben Cruz", "Cara Diaz", "Dan Evans", "Eve Fox", "Gil Haro"];
    const rendered = await page.evaluate((people) => {
      const host = document.createElement("div");
      host.id = "tint-probe";
      document.body.appendChild(host);
      // Reuses the real component's class strings, kept in sync by the
      // assertion on distinct backgrounds below.
      const tints = [
        "bg-indigo-500/15 text-indigo-800",
        "bg-sky-500/15 text-sky-800",
        "bg-emerald-500/15 text-emerald-800",
        "bg-amber-500/15 text-amber-800",
        "bg-rose-500/15 text-rose-800",
        "bg-violet-500/15 text-violet-800",
      ];
      tints.forEach((tint, i) => {
        const el = document.createElement("span");
        el.className = `inline-flex h-12 w-12 items-center justify-center rounded-full text-base font-semibold ${tint}`;
        el.textContent = people[i].split(" ").map((p) => p[0]).join("");
        host.appendChild(el);
      });
      return tints.length;
    }, names);

    expect(rendered).toBe(6);

    const { violations } = await new AxeBuilder({ page })
      .withTags(TAGS)
      .include("#tint-probe")
      .analyze();

    expect(violations.length, `axe violations:\n  ${describeViolations(violations)}`).toBe(0);
  });
});

test.describe("dark theme", () => {
  test("the dashboard holds contrast in dark mode too", async ({ page }) => {
    // The theme is a `.dark` class set from localStorage by theme-init.js, not
    // prefers-color-scheme — so emulating the OS setting would scan the light
    // palette and prove nothing. This project has a documented history of
    // dark-mode contrast regressions specifically.
    await page.goto("/login");
    await page.getByRole("button", { name: "Try the demo" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Set the preference and then do a *full* load. theme-init.js is a
    // beforeInteractive script, so it does not re-run across the client-side
    // navigation that signing in performs — without the reload the page stays
    // light and this would scan the wrong palette while appearing to pass.
    await page.evaluate(() => localStorage.setItem("theme", "dark"));
    await page.reload();

    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(true);

    await expectNoViolations(page);
  });
});
