import { expect, test } from "@playwright/test";
import { uploadSample, useScenario, waitForReady } from "./helpers";

// Found while capturing docs screenshots: with a highlight focused, the key hint under it
// collapsed on blur, shifting the cards below mid-click, so "Pick frame" on the next step
// did nothing. The hint now keeps its space and only fades.
test("clicking another step's Pick frame while a highlight is focused opens the picker", async ({ page }) => {
  await useScenario(page, "happy");
  await page.goto("/");
  await uploadSample(page);
  await waitForReady(page);
  await page.getByRole("button", { name: /highlight on step 1 screenshot/i }).focus();
  await page.getByRole("button", { name: /^pick frame for step 2$/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
