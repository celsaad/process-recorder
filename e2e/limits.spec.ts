import { expect, test } from "@playwright/test";
import {
  CORRUPT,
  LONG_5MIN,
  TOO_LONG,
  trackUploads,
  uploadSample,
  useScenario,
  waitForReady,
} from "./helpers";

// D16: 3:00-10:00 is accepted with an info notice; over 10:00 is rejected client-side.
test("a 5:00 recording is accepted and shows the long-video notice", async ({ page }) => {
  await useScenario(page, "happy");
  await page.goto("/");
  await uploadSample(page, LONG_5MIN);
  await waitForReady(page);

  await expect(
    page.getByText(/this recording is 5:00\. longer recordings take longer to process/i),
  ).toBeVisible();
});

test("a 10:30 recording is rejected as too_long before any upload", async ({ page }) => {
  const uploads = trackUploads(page);
  await useScenario(page, "happy");
  await page.goto("/");
  await uploadSample(page, TOO_LONG);

  await expect(page.getByRole("heading", { name: /video is too long/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(/this video is 10:30\. recordings must be 10 minutes or less/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /choose (another )?file/i })).toBeVisible();
  expect(uploads).toHaveLength(0);
});

test("a corrupt MP4 is rejected as undecodable before any upload", async ({ page }) => {
  const uploads = trackUploads(page);
  await useScenario(page, "happy");
  await page.goto("/");
  await uploadSample(page, CORRUPT);

  await expect(page.getByRole("heading", { name: /video can't be played/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/re-export it as h\.264 mp4/i)).toBeVisible();
  expect(uploads).toHaveLength(0);
});
