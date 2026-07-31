import { expect, test } from "@playwright/test";

test("the landing page is public and shows the product", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "one intelligent workspace",
  );
  await expect(
    page.getByRole("img", { name: /Nexus CRM dashboard/i }),
  ).toBeVisible();
});

test("the hero call to action reaches sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Try the live demo" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
});

// Guards the proxy change: "/" became public, and the signed-in redirect that
// used to live in app/page.tsx now has to come from the proxy instead.
test("signed-in visitors are sent from the landing page to the dashboard", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
});
