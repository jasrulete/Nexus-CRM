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

test("the sidebar brand returns to the dashboard", async ({ page }) => {
  await page.goto("/contacts");
  await page.getByRole("link", { name: "Nexus CRM home" }).first().click();

  await expect(page).toHaveURL(/\/dashboard$/);
});

// Runs green with no AI or email credentials: draftFollowUp falls back to the
// heuristic writer, and sendFollowUp takes its simulated path.
test("a drafted follow-up can be sent to yourself and lands in the feed", async ({
  page,
}) => {
  await page.goto("/contacts");
  await page.locator('a[href^="/contacts/"]').first().click();
  await page.waitForURL(/\/contacts\/.+/);

  await page.getByRole("button", { name: "Draft a follow-up email" }).click();
  // Waits on a real model call when an AI key is configured, so this needs more
  // than the 5s budget a local UI interaction gets.
  await expect(page.getByText("Follow-up draft")).toBeVisible({ timeout: 30_000 });

  await page
    .getByRole("button", { name: "Send this draft to your own inbox" })
    .click();

  // Matches the result message specifically, not the static hint above the
  // button — otherwise this passes even when the send never happened.
  await expect(
    page.getByText(/Set RESEND_API_KEY|does not deliver real email|^Sent to /),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/\[simulated send\]|Sent to /).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("extra context can be added before drafting", async ({ page }) => {
  await page.goto("/contacts");
  await page.locator('a[href^="/contacts/"]').first().click();
  await page.waitForURL(/\/contacts\/.+/);

  await page.getByRole("button", { name: /Add context for the draft/i }).click();
  const box = page.getByLabel("Extra context for the draft");
  await expect(box).toBeVisible();
  await box.fill("They just closed a funding round.");

  await page.getByRole("button", { name: "Draft a follow-up email" }).click();
  await expect(page.getByText("Follow-up draft")).toBeVisible({ timeout: 30_000 });
});

test("a file can be attached as context for the draft", async ({ page }) => {
  await page.goto("/contacts");
  await page.locator('a[href^="/contacts/"]').first().click();
  await page.waitForURL(/\/contacts\/.+/);

  await page.getByRole("button", { name: /Add context for the draft/i }).click();
  await page.getByLabel("Attach a PDF or text file").setInputFiles({
    name: "renewal-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Renewal is due in March. Budget approved at 42000 USD."),
  });

  // The chip proves the server parsed it — the count comes from extracted text.
  await expect(page.getByText(/renewal-notes\.txt/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/chars/)).toBeVisible();

  await page.getByRole("button", { name: "Draft a follow-up email" }).click();
  await expect(page.getByText("Follow-up draft")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Remove attached file" }).click();
  await expect(page.getByText(/renewal-notes\.txt/)).toBeHidden();
});

test("an unsupported file is rejected with a reason", async ({ page }) => {
  await page.goto("/contacts");
  await page.locator('a[href^="/contacts/"]').first().click();
  await page.waitForURL(/\/contacts\/.+/);

  await page.getByRole("button", { name: /Add context for the draft/i }).click();
  await page.getByLabel("Attach a PDF or text file").setInputFiles({
    name: "payload.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("MZ binary"),
  });

  await expect(page.getByText(/Only PDF, \.txt and \.md/i)).toBeVisible({
    timeout: 20_000,
  });
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
