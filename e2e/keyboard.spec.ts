import { expect, test } from "@playwright/test";
import { RESULTS_HEADING_ID, tabTo, TINY_WEBM, useScenario } from "./helpers";

// Keyboard flow from UX.md: no custom shortcuts, Tab order + labelled buttons.
// Every target below is reached with real Tab presses, never `.focus()`.
test("whole flow with the keyboard only", async ({ page }) => {
  await useScenario(page, "happy");
  await page.goto("/");

  // The dropzone is the first tab stop after the header; Enter opens the file chooser.
  const dropzone = page.getByRole("button", {
    name: /^choose a recording/i,
  });
  await tabTo(page, dropzone, 6);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles(TINY_WEBM);

  // Focus lands on the results heading only after capture ends.
  await expect(page.getByRole("status")).toContainText(/\d+ steps? ready/i, { timeout: 45_000 });
  await expect(page.locator(`#${RESULTS_HEADING_ID}`)).toBeFocused({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  const stepHeadings = page.getByRole("heading", { name: /^Step \d+$/ });
  const initialCount = await stepHeadings.count();
  expect(initialCount).toBeGreaterThanOrEqual(3);
  const firstAction = await page.getByLabel("Action").first().inputValue();

  // Step card tab order (UX.md): Action -> Description -> Expected result -> ... -> Pick frame.
  const card = page.getByRole("article").first();
  await tabTo(page, card.getByLabel("Action"));
  await page.keyboard.press("Tab");
  await expect(card.getByLabel("Description")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(card.getByLabel("Expected result")).toBeFocused();

  // Frame picker: open, step with Shift+Arrow (1 s), Enter confirms, focus returns to the trigger.
  const timestamp = card.getByRole("button", { name: /^\d+:\d{2}/ });
  const timeBefore = await timestamp.innerText();
  const trigger = page.getByRole("button", { name: /^pick frame for step 1\b/i });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const slider = dialog.getByRole("slider");
  await expect(slider).toBeFocused();
  const valueBefore = Number(await slider.getAttribute("aria-valuenow"));
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(async () => Number(await slider.getAttribute("aria-valuenow")))
    .toBeGreaterThan(valueBefore);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(timestamp).not.toHaveText(timeBefore);

  // Esc cancels the picker and also returns focus to the trigger.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();

  // Move step 1 down: focus stays on the (same) button, now in its new position.
  const moveDown = page.getByRole("button", { name: /move.*step 1\b.*down|move down.*step 1\b/i });
  await tabTo(page, moveDown);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(/moved to position 2/i);
  await expect(page.getByLabel("Action").nth(1)).toHaveValue(firstAction);
  await expect(page.locator(":focus")).toHaveAccessibleName(/move.*down/i);

  // Delete step 2 (the moved one): focus goes to the inline row's Undo button.
  await tabTo(page, page.getByRole("button", { name: /^delete step 2\b/i }));
  await page.keyboard.press("Enter");
  await expect(page.getByText(/step 2 deleted/i)).toBeVisible();
  await expect(stepHeadings).toHaveCount(initialCount - 1);
  const undo = page.getByRole("button", { name: /^undo/i });
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");

  // Undo restores the step and focuses its heading.
  await expect(stepHeadings).toHaveCount(initialCount);
  await expect(page.getByLabel("Action").nth(1)).toHaveValue(firstAction);
  await expect(page.getByRole("heading", { name: "Step 2" })).toBeFocused();
});
