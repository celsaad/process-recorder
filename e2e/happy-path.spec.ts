import { expect, test } from "@playwright/test";
import { TINY_MP4, TINY_WEBM, uploadSample, useScenario, waitForReady } from "./helpers";

for (const [format, file] of [
  ["webm", TINY_WEBM],
  ["mp4", TINY_MP4],
] as const) {
  test(`upload ${format} -> steps with screenshots -> edit -> export .docx`, async ({ page }) => {
    await useScenario(page, "happy");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^choose a recording/i }),
    ).toBeVisible();

    await uploadSample(page, file);
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

    // Export -> .docx named after the project title (the fake's title: "Create a purchase order").
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^export to word/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("create-a-purchase-order.docx");
  });
}

test("the stage list shows where the time goes, with a Cancel button", async ({ page }) => {
  await useScenario(page, "slow");
  await page.goto("/");
  await uploadSample(page);

  // UX.md "Uploading": Receiving > Sending to Gemini > Gemini processing > Analyzing > Screenshots.
  const stages = page.getByRole("list", { name: /stage|progress/i });
  await expect(stages).toBeVisible();
  for (const stage of [/receiving/i, /sending to gemini/i, /gemini processing/i, /analyzing/i]) {
    await expect(stages.getByRole("listitem").filter({ hasText: stage })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /^cancel/i })).toBeVisible();
});
