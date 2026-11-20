import { expect, test } from "@playwright/test";
import { uploadSample, useScenario } from "./helpers";

test("Cancel during a slow job returns to the empty state and announces it", async ({ page }) => {
  await useScenario(page, "slow");
  await page.goto("/");
  await uploadSample(page);

  await page.getByRole("button", { name: /^cancel/i }).click();

  await expect(page.getByRole("status")).toContainText(/cancelled/i);
  const dropzone = page.getByRole("button", {
    name: /^choose a recording/i,
  });
  await expect(dropzone).toBeVisible();
  await expect(dropzone).toBeEnabled();
  await expect(page.getByRole("article")).toHaveCount(0);
});
