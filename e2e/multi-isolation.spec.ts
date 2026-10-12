import path from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Browser } from "@playwright/test";

/**
 * Multi mode, end to end (spec §9.9). Runs only in the "multi" Playwright
 * project, against its own server: WORKSPACE_MODE=multi, DEMO_MODE unset, and
 * a database that is migrated but never seeded, e2e-multi.db at the repo root
 * (CI prepares it; see .github/workflows/ci.yml). The default project ignores
 * every e2e/multi-*.spec.ts.
 */

// The file the multi server opened: start-standalone.mjs resolves a relative
// file: URL against the repo root, which is also Playwright's cwd.
const MULTI_DB = path.resolve("e2e-multi.db");

function withMultiDb<T>(fn: (db: Database.Database) => T): T {
  // fileMustExist: a missing database is a setup error, not a new empty file.
  const db = new Database(MULTI_DB, { fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function unique() {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`;
}

/** Registers in a fresh browser context and returns it signed in on /dashboard. */
async function signUp(browser: Browser, label: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const suffix = unique();
  const name = `${label} Isolation ${suffix}`;
  const email = `e2e-${label.toLowerCase()}-${suffix}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("isolation-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  return { context, page, name, email };
}

test("two sign-ups each get a private workspace that the other cannot read", async ({ browser }) => {
  const a = await signUp(browser, "Alpha");

  // A new workspace starts empty: no seeded or foreign data in a sign-up.
  await a.page.goto("/contacts");
  await expect(a.page.locator('a[href^="/contacts/"]')).toHaveCount(0);

  const last = `Private${unique()}`;
  await a.page.getByRole("button", { name: "New contact" }).click();
  const dialog = a.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("First name").fill("Alpha");
  await dialog.getByLabel("Last name").fill(last);
  await dialog.getByRole("button", { name: /save|create|add/i }).click();
  await expect(dialog).toBeHidden();
  const link = a.page.locator('a[href^="/contacts/"]').filter({ hasText: `Alpha ${last}` });
  await expect(link).toHaveCount(1);
  const href = (await link.getAttribute("href"))!;

  // A second sign-up never joins the first one's workspace.
  const b = await signUp(browser, "Bravo");

  // Not in the list.
  await b.page.goto("/contacts");
  await expect(b.page.getByText(`Alpha ${last}`)).toHaveCount(0);

  // Not in search.
  await b.page.goto("/dashboard");
  await b.page.getByRole("button", { name: "Search", exact: true }).click();
  const palette = b.page.getByRole("dialog", { name: "Search" });
  await expect(palette).toBeVisible();
  await b.page.keyboard.type(last);
  await expect(palette.getByRole("status")).toContainText("No matches");
  await b.page.keyboard.press("Escape");

  // Not by its URL: another workspace's id reads as "not found".
  await b.page.goto(href);
  await expect(b.page.getByText("Not found")).toBeVisible();

  // Not on Settings: the roster and the audit card are this workspace's only.
  await b.page.goto("/settings");
  await expect(b.page.getByText(b.email).first()).toBeVisible();
  await expect(b.page.getByText(a.email)).toHaveCount(0);
  await expect(b.page.getByText(a.name)).toHaveCount(0);

  // And the owner still has it.
  await a.page.goto(href);
  await expect(a.page.getByRole("heading", { level: 1 })).toContainText(`Alpha ${last}`);

  await a.context.close();
  await b.context.close();
});

test("a signed-in user whose membership is gone is signed out to /login, not looped", async ({ browser }) => {
  const c = await signUp(browser, "Charlie");

  // What spec 3's member removal (or an old-build window) leaves behind: a
  // valid session for a user with no membership.
  const userId = withMultiDb((db) => {
    const row = db.prepare('SELECT "id" FROM "User" WHERE "email" = ?').get(c.email) as { id: string };
    expect(db.prepare('DELETE FROM "Membership" WHERE "userId" = ?').run(row.id).changes).toBe(1);
    return row.id;
  });

  await c.page.goto("/dashboard");
  await expect(c.page).toHaveURL(/\/login$/);
  await expect(c.page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect((await c.context.cookies()).map((cookie) => cookie.name)).not.toContain("nexus_session");

  // No /login <-> /dashboard loop: the app stays signed out.
  await c.page.goto("/dashboard");
  await expect(c.page).toHaveURL(/\/login$/);

  // The session row went with the cookie.
  const sessions = withMultiDb(
    (db) =>
      (db.prepare('SELECT COUNT(*) AS n FROM "Session" WHERE "userId" = ?').get(userId) as { n: number }).n,
  );
  expect(sessions).toBe(0);

  await c.context.close();
});

// The same stale session, reached through a server action instead of a page
// navigation. A server action's redirect is followed server-side and only the
// final hop's headers reach the browser, so the cookie delete that
// /auth/signout-stale issues on the way to /login is not guaranteed to arrive.
// The page case above cannot show that; this one does.
test("a server action submitted after the membership is gone ends signed out on /login, not looped", async ({
  browser,
}) => {
  const d = await signUp(browser, "Delta");

  // Open the form while the membership still exists.
  await d.page.goto("/contacts");
  await d.page.getByRole("button", { name: "New contact" }).click();
  const dialog = d.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("First name").fill("Delta");
  await dialog.getByLabel("Last name").fill(`Stale${unique()}`);

  // The cookie is there to lose: without this the "gone" check below proves nothing.
  expect((await d.context.cookies()).map((cookie) => cookie.name)).toContain("nexus_session");

  // The membership goes while the form is open.
  const userId = withMultiDb((db) => {
    const row = db.prepare('SELECT "id" FROM "User" WHERE "email" = ?').get(d.email) as { id: string };
    expect(db.prepare('DELETE FROM "Membership" WHERE "userId" = ?').run(row.id).changes).toBe(1);
    return row.id;
  });

  // Submitting runs createContact -> requireWorkspace -> redirect to /auth/signout-stale.
  await dialog.getByRole("button", { name: /save|create|add/i }).click();
  await expect(d.page).toHaveURL(/\/login$/);
  await expect(d.page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect((await d.context.cookies()).map((cookie) => cookie.name)).not.toContain("nexus_session");

  // The session row went with the cookie.
  const sessions = withMultiDb(
    (db) =>
      (db.prepare('SELECT COUNT(*) AS n FROM "Session" WHERE "userId" = ?').get(userId) as { n: number }).n,
  );
  expect(sessions).toBe(0);

  // No /login <-> /dashboard loop: the app stays signed out.
  await d.page.goto("/dashboard");
  await expect(d.page).toHaveURL(/\/login$/);

  await d.context.close();
});
