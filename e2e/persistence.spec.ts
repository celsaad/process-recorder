import { expect, test } from "@playwright/test";
import { expectProjectStored, uploadSample, useScenario, waitForReady } from "./helpers";

test("edits and screenshots survive a reload; Start new clears them", async ({ page }) => {
  const dropzone = page.getByRole("button", {
    name: /drop a screen recording or choose a file/i,
  });
  await useScenario(page, "happy");
  await page.goto("/");
  await uploadSample(page);
  await waitForReady(page);
  await expect(page.getByRole("img", { name: "Screenshot for step 1" })).toBeVisible({
    timeout: 30_000,
  });

  // Edits are debounced (500 ms) and "Saving" lasts milliseconds: poll IndexedDB instead.
  const edited = "Persisted edit from the E2E test";
  await page.getByLabel("Action").first().fill(edited);
  await expectProjectStored(page, edited);

  await page.reload();
  await expect(page.getByRole("status")).toContainText(/restored your last project/i);
  await expect(page.getByLabel("Action").first()).toHaveValue(edited);
  await expect(page.getByRole("img", { name: "Screenshot for step 1" })).toBeVisible({
    timeout: 30_000,
  });

  // "Start new" asks for confirmation in an alert dialog.
  await page.getByRole("button", { name: /start new/i }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /start new|confirm|continue|yes/i })
    .click();
  await expect(dropzone).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);

  // Still empty after another reload.
  await page.reload();
  await expect(dropzone).toBeVisible();
});
