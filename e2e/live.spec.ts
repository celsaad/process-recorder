import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { uploadSample } from "./helpers";

// Real Gemini. Run by hand: GEMINI_LIVE=1 GEMINI_API_KEY=... pnpm test:e2e live
// (playwright.config.ts then starts the server without GEMINI_FAKE).
// The sample videos are not in git: resolved from the repo root, overridable with LIVE_SAMPLE.
const SAMPLE = process.env.LIVE_SAMPLE ?? resolve(process.cwd(), "samples/j45-pr-po-si.mp4");

/** Video length in seconds via ffprobe, or the 3:00 soft limit if ffprobe isn't installed. */
function videoDurationSec(file: string): number {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { encoding: "utf8" },
    );
    return Math.ceil(Number(out.trim()));
  } catch {
    return 180;
  }
}

test.skip(process.env.GEMINI_LIVE !== "1", "set GEMINI_LIVE=1 to run against real Gemini");

test("@live real Gemini finds at least 3 steps with timestamps inside the video", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  const duration = videoDurationSec(SAMPLE);
  await page.goto("/");
  await uploadSample(page, SAMPLE);

  await expect(page.getByRole("status")).toContainText(/\d+ steps? ready/i, {
    timeout: 6 * 60_000,
  });
  const count = await page.getByRole("heading", { name: /^Step \d+$/ }).count();
  expect(count).toBeGreaterThanOrEqual(3);

  // Each step card has a timestamp button (M:SS) inside the video.
  const stamps = await page.getByRole("button", { name: /^\d+:\d{2}/ }).allInnerTexts();
  expect(stamps).toHaveLength(count);
  for (const text of stamps) {
    const [m, s] = text.trim().split(":").map(Number);
    expect(m * 60 + s).toBeLessThanOrEqual(duration);
  }
});
