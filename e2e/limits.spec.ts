import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  CORRUPT,
  LONG_5MIN,
  TINY_MP4,
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

  await expect(page.getByRole("heading", { name: /recording is too long/i })).toBeVisible({
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
  await expect(page.getByText(/re-export it as an h\.264 mp4/i)).toBeVisible();
  expect(uploads).toHaveLength(0);
});

// Some OSes (notably Windows) report an empty MIME type for .mov. The client must infer
// it from the extension, or the server rejects a valid recording as unsupported_type (#1).
// Playwright's setInputFiles infers a type from the name, so build the File in the page
// with a genuinely empty type, as such a browser would hand it to us.
test("a .mov with an empty MIME type still uploads and gets steps", async ({ page }) => {
  await useScenario(page, "happy");
  await page.goto("/");
  const uploads = trackUploads(page);
  const base64 = readFileSync(TINY_MP4).toString("base64");
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "Recording.mov", { type: "" });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, base64);
  await waitForReady(page);
  expect(uploads).toHaveLength(1);
  await expect(page.getByRole("img", { name: /screenshot for step 1/i })).toBeVisible();
});
