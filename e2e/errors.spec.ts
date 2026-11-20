import { expect, test, type Page } from "@playwright/test";
import { NOT_A_VIDEO, uploadSample, useScenario } from "./helpers";

function trackUploads(page: Page): string[] {
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/upload")) uploads.push(r.url());
  });
  return uploads;
}

test("a PDF is rejected as unsupported_type before any upload", async ({ page }) => {
  const uploads = trackUploads(page);
  await useScenario(page, "happy");
  await page.goto("/");
  await uploadSample(page, NOT_A_VIDEO);

  await expect(page.getByRole("heading", { name: /unsupported file type/i })).toBeVisible();
  await expect(page.getByText(/upload an mp4, mov or webm screen recording/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /choose (another )?file/i })).toBeVisible();
  expect(uploads).toHaveLength(0);
});

test("rate_limited: Retry re-runs analysis without a second upload", async ({ page }) => {
  const uploads = trackUploads(page);
  await useScenario(page, "rate_limited");
  await page.goto("/");
  await uploadSample(page);

  await expect(page.getByRole("heading", { name: /too many requests/i })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText(/rate-limiting requests/i)).toBeVisible();
  expect(uploads).toHaveLength(1);

  const analyzeRequest = page.waitForRequest((r) => r.url().includes("/api/analyze"));
  await page.getByRole("button", { name: /retry/i }).click();
  await analyzeRequest;
  expect(uploads).toHaveLength(1);
});

test("not_screen_recording shows the reason and a way to choose another file", async ({ page }) => {
  await useScenario(page, "not_screen_recording");
  await page.goto("/");
  await uploadSample(page);

  await expect(
    page.getByRole("heading", { name: /doesn't look like a screen recording/i }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByText(/screen recording of someone clicking through a process/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /choose (another )?file/i })).toBeVisible();
});

test("no_steps shows the NoSteps UI with 'Add a step manually'", async ({ page }) => {
  await useScenario(page, "no_steps");
  await page.goto("/");
  await uploadSample(page);

  const manual = page.getByRole("button", { name: /add a step manually/i });
  await expect(manual).toBeVisible({ timeout: 45_000 });
  await manual.click();
  await expect(page.getByRole("heading", { name: "Step 1" })).toBeVisible();
});
