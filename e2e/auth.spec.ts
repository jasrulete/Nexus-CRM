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
