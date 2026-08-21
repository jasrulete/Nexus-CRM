import { expect, test } from "@playwright/test";

test("unauthenticated visitors are redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("the demo button signs in and lands on the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo");
});

test("bad credentials show an error and do not sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@nexuscrm.dev");
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("signing out returns to login and protects the app again", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();

  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/contacts");
  await expect(page).toHaveURL(/\/login$/);
});

// Registration is open, so a MEMBER must not be able to read the roster of
// every address that has ever signed up. The Team card on /settings selected
// `email` for everyone with no admin condition, three lines above an audit-log
// query that *was* gated.
test("a member cannot read other accounts' email addresses", async ({
  page,
}) => {
  // Unique per run so repeated local runs don't collide on the shared demo DB
  // — a fixed name accumulates one identically-labelled row per run, and the
  // row locator below then matches all of them. The seeded admin already
  // exists, so a fresh registration is a MEMBER.
  const suffix = Date.now().toString().slice(-8);
  const name = `Playwright Member ${suffix}`;
  const email = `e2e-member-${suffix}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("member-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings");
  const ownRow = page.getByRole("listitem").filter({ hasText: name });

  // The Team card still lists everyone by name — only the addresses are gated,
  // so this proves the fix scoped the leak rather than emptying the card.
  // "Demo User" not "Demo": hasText is a case-insensitive substring, so the
  // looser form would also be satisfied by a row leaking demo@nexuscrm.dev.
  await expect(
    page.getByRole("listitem").filter({ hasText: "Demo User" }),
  ).not.toHaveCount(0);

  // Their own address is theirs to see; nobody else's appears anywhere.
  await expect(ownRow.getByText(email)).toBeVisible();
  await expect(page.getByText("demo@nexuscrm.dev")).toHaveCount(0);
});

// The authorization boundary the audit found had no test at any level: reads
// are workspace-wide by design, so a member can open any contact — but the
// update actions had no owner check while their delete siblings did, meaning
// a member could rewrite every field of a record they cannot delete.
test("a member cannot edit a contact owned by someone else", async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-8);

  // Registering makes a MEMBER — the seeded admin already exists — and the
  // new account owns nothing, so every seeded contact belongs to someone else.
  await page.goto("/register");
  await page.getByLabel("Full name").fill(`Playwright Outsider ${suffix}`);
  await page.getByLabel("Email").fill(`e2e-outsider-${suffix}@example.com`);
  await page.getByLabel("Password").fill("outsider-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/contacts");
  await page.locator('a[href^="/contacts/"]').first().click();
  await expect(page).toHaveURL(/\/contacts\/.+/);

  await page.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("First name").fill("Hijacked");
  await dialog.getByRole("button", { name: /save|update/i }).click();

  // Refused in the form rather than thrown, so the dialog stays open with the
  // typed value intact instead of tripping the error boundary.
  await expect(dialog.getByText("You can only edit records you own.")).toBeVisible();
  await expect(dialog).toBeVisible();

  // And the record itself is untouched.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText(
    "Hijacked",
  );
});
