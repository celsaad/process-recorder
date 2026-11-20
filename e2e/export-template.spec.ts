import { expect, test } from "@playwright/test";
import { uploadSample, useScenario, waitForReady } from "./helpers";

test("export options: add a blank Pass/Fail column, then export", async ({ page }) => {
  await useScenario(page, "happy");
  await page.goto("/");
  await uploadSample(page);
  await waitForReady(page);

  const trigger = page.getByRole("button", { name: "Export options" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Export options" });
  await dialog.getByRole("button", { name: "Add blank column" }).click();
  const header = dialog.getByRole("textbox", { name: "Header for column 6" });
  await expect(header).toBeFocused();
  await header.fill("Pass/Fail");
  await expect(dialog.getByRole("button", { name: "Remove 'Pass/Fail'" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to Word" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("create-a-purchase-order.docx");

  // The template is remembered across reloads.
  const stored = await page.evaluate(() => localStorage.getItem("export-template-last"));
  expect(stored).toContain("Pass/Fail");
});
