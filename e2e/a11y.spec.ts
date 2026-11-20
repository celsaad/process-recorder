import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, uploadSample, useScenario, waitForReady } from "./helpers";

test.describe("axe scans (WCAG 2.2 AA)", () => {
  test("empty state", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /drop a screen recording or choose a file/i }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("processing state", async ({ page }) => {
    await useScenario(page, "slow");
    await page.goto("/");
    await uploadSample(page);
    await expect(page.getByRole("button", { name: /^cancel/i })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("ready state and frame picker open", async ({ page }) => {
    await useScenario(page, "happy");
    await page.goto("/");
    await uploadSample(page);
    await waitForReady(page);
    await expect(page.getByRole("img", { name: "Screenshot for step 1" })).toBeVisible({
      timeout: 30_000,
    });
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: /pick frame for step 1\b/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("error state", async ({ page }) => {
    await useScenario(page, "gemini_failed");
    await page.goto("/");
    await uploadSample(page);
    await expect(page.getByRole("heading", { name: /processing failed/i })).toBeVisible({
      timeout: 45_000,
    });
    await expectNoAxeViolations(page);
  });
});
