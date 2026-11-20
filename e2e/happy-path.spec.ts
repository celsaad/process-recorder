import { expect, test } from "@playwright/test";
import { uploadSample, useScenario, waitForReady } from "./helpers";

test("upload -> stages -> steps with screenshots -> edit -> export .docx", async ({ page }) => {
  await useScenario(page, "happy");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /drop a screen recording or choose a file/i }),
  ).toBeVisible();

  await uploadSample(page);

  // Honest stage list (UX.md "Uploading"): the stages are visible while the job runs.
  await expect(
    page.getByText(/receiving|sending to gemini|gemini processing|analyzing/i).first(),
  ).toBeVisible();

  await waitForReady(page);

  // Every step has a screenshot with alt "Screenshot for step N".
  const count = await page.getByRole("article").count();
  expect(count).toBeGreaterThanOrEqual(3);
  for (let n = 1; n <= count; n++) {
    await expect(page.getByRole("img", { name: `Screenshot for step ${n}` })).toBeVisible({
      timeout: 30_000,
    });
  }

  // Edit a field.
  const action = page.getByLabel("Action").first();
  await action.fill("Edited by the E2E test");
  await expect(action).toHaveValue("Edited by the E2E test");

  // Export -> .docx download named after the project title (fake title: "Create a purchase order").
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^export/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("create-a-purchase-order.docx");
});
