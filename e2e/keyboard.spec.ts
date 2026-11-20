import { expect, test } from "@playwright/test";
import { TINY_VIDEO, useScenario } from "./helpers";

// Keyboard flow from UX.md: no custom shortcuts, Tab order + labelled buttons.
test("whole flow with the keyboard only", async ({ page }) => {
  await useScenario(page, "happy");
  await page.goto("/");

  // Dropzone is the first tab stop after the header; Enter opens the file chooser.
  const dropzone = page.getByRole("button", {
    name: /drop a screen recording or choose a file/i,
  });
  await dropzone.focus();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles(TINY_VIDEO);

  // Focus lands on the results heading only after capture ends.
  await expect(page.getByRole("status")).toContainText(/\d+ steps? ready/i, { timeout: 45_000 });
  await expect(page.locator("#results-heading")).toBeFocused({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  const stepHeadings = page.getByRole("heading", { name: /^Step \d+$/ });
  const initialCount = await stepHeadings.count();
  expect(initialCount).toBeGreaterThanOrEqual(3);

  // Move step 1 down: focus stays on the (same) button, now in its new position.
  const firstAction = await page.getByLabel("Action").first().inputValue();
  const moveDown = page.getByRole("button", { name: /move.*step 1\b.*down|move down.*step 1\b/i });
  await moveDown.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(/moved to position 2/i);
  await expect(page.getByLabel("Action").nth(1)).toHaveValue(firstAction);
  await expect(page.locator(":focus")).toHaveAccessibleName(/move.*down/i);

  // Delete step 2 (the moved one), then Undo: one Shift+Tab from the next step.
  await page.getByRole("button", { name: /delete step 2\b/i }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/step 2 deleted/i)).toBeVisible();
  await expect(stepHeadings).toHaveCount(initialCount - 1);
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(":focus")).toHaveAccessibleName(/undo/i);
  await page.keyboard.press("Enter");
  await expect(stepHeadings).toHaveCount(initialCount);
  await expect(page.getByLabel("Action").nth(1)).toHaveValue(firstAction);

  // Frame picker: open, step with arrows, Enter confirms, focus returns to the trigger.
  const trigger = page.getByRole("button", { name: /pick frame for step 1\b/i });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const slider = dialog.getByRole("slider");
  await slider.focus();
  const before = Number(await slider.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Esc cancels the picker and also returns focus to the trigger.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});
