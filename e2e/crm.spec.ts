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

test("a deal can be moved between stages with the keyboard alone", async ({
  page,
}) => {
  // The board is this CRM's signature interaction and was entirely mouse-only:
  // dnd-kit gives each card role="button" and a tabIndex, so it focused, but no
  // KeyboardSensor was registered and nothing responded to a key. WCAG 2.1.1.
  const STAGES = ["Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];
  await page.goto("/deals");

  const card = page.getByRole("button", { name: /Plant ops pilot/ }).first();
  await expect(card).toBeVisible();

  // Read the starting column rather than assuming it: this test moves a real
  // row, so a repeat run against the same database starts somewhere else.
  const startStage = await card.evaluate((el) =>
    el.closest('[role="group"]')?.getAttribute("aria-label") ?? "",
  );
  const startIndex = STAGES.indexOf(startStage.replace(" deals", ""));
  expect(startIndex).toBeGreaterThanOrEqual(0);

  // This test moves a real row and does not move it back, so consecutive runs
  // walk the card along the board until it reaches an end. Pick the direction
  // from where the card actually is rather than assuming there is room to the
  // right — otherwise the suite passes until the day it doesn't.
  const goRight = startIndex < STAGES.length - 1;
  const arrow = goRight ? "ArrowRight" : "ArrowLeft";
  const expected = `${STAGES[startIndex + (goRight ? 1 : -1)]} deals`;

  await card.focus();
  await expect(card).toBeFocused();

  // Space picks the card up, arrows move it, Space drops it. Enter is
  // deliberately not an activator so it stays free to open the card. dnd-kit
  // needs a frame between each step, so the presses are not back to back.
  await page.keyboard.press("Space");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press(arrow);
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");

  // The move is optimistic then persisted; a reload proves it reached the
  // database rather than only the client state.
  await page.waitForTimeout(1500);
  await page.reload();

  await expect(
    page.getByRole("group", { name: expected }).getByText(/Plant ops pilot/),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("group", { name: startStage }).getByText(/Plant ops pilot/),
  ).toHaveCount(0);
});

test("Enter opens a deal card without starting a drag", async ({ page }) => {
  await page.goto("/deals");

  const card = page.getByRole("button", { name: /CS tooling/ }).first();
  await card.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title")).toHaveValue(/CS tooling/);
});

test("a deal in another currency shows both amounts, and totals convert", async ({
  page,
}) => {
  // Deal.currency used to be written on every row and read nowhere, so a
  // non-USD amount would have been summed into the totals as if it were
  // dollars. The seed carries one EUR deal specifically to keep this honest.
  await page.goto("/deals");

  const card = page.getByRole("button", { name: /Team plan/ }).first();
  await expect(card).toBeVisible();

  // Converted amount first, the amount actually entered in parentheses.
  await expect(card).toContainText("(EUR 9,600)");
  await expect(card).toContainText("$11,231");

  // A deal already in the workspace currency gets no parenthetical. Matched on
  // the currency-code pattern, not a bare "(" — this deal is titled
  // "Analytics platform (annual)".
  const domestic = page.getByRole("button", { name: /Analytics platform/ }).first();
  await expect(domestic).toContainText("$48,000");
  expect(await domestic.textContent()).not.toMatch(/\([A-Z]{3}\s[\d,]+\)/);
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
