import { expect, type Page } from "@playwright/test";

/**
 * Opens the search palette with ⌘K / Ctrl+K.
 *
 * The shortcut listener attaches when React hydrates, which `page.goto` does
 * not wait for — on a cold dev compile the first keypress lands before it. So
 * press until the dialog appears, never pressing while it is already open
 * (the shortcut toggles).
 */
export async function openPaletteWithKeyboard(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}
