import { expect, test } from "@playwright/test";

// Every test in this file starts signed in as the seeded demo user.
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("creates a contact and finds it via search", async ({ page }) => {
  // Unique per run so repeated local runs don't collide on the shared demo DB.
  const last = `E2E${Date.now().toString().slice(-6)}`;

  await page.goto("/contacts");
  await page.getByRole("button", { name: "New contact" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("First name").fill("Playwright");
  await dialog.getByLabel("Last name").fill(last);
  await dialog.getByLabel("Email").fill(`${last.toLowerCase()}@example.com`);
  await dialog.getByRole("button", { name: /save|create|add/i }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Playwright ${last}`)).toBeVisible();

  await page.getByLabel("Search contacts").fill(last);
  await page.getByLabel("Search contacts").press("Enter");
  await expect(page).toHaveURL(new RegExp(`q=${last}`, "i"));
  await expect(page.getByText(`Playwright ${last}`)).toBeVisible();
});

test("contact detail opens from the list", async ({ page }) => {
  await page.goto("/contacts");
  const firstLink = page.locator('a[href^="/contacts/"]').first();
  const href = await firstLink.getAttribute("href");
  await firstLink.click();

  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
  // Sections that only exist on the detail page.
  await expect(page.getByText("Open tasks")).toBeVisible();
  await expect(page.getByText("AI insights")).toBeVisible();
});

test("the pipeline board renders its stage columns", async ({ page }) => {
  await page.goto("/deals");
  for (const stage of ["Lead", "Qualified", "Proposal"]) {
    await expect(page.getByText(stage, { exact: false }).first()).toBeVisible();
  }
});

test("a missing record renders the branded 404, not a crash", async ({
  page,
}) => {
  await page.goto("/contacts/this-id-does-not-exist");
  await expect(page.getByText("Not found")).toBeVisible();
  await expect(page.getByRole("link", { name: /back to dashboard/i })).toBeVisible();
});

test("the health endpoint answers without a session", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});
