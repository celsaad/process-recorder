import { expect, test } from "@playwright/test";
import { uploadSample } from "./helpers";

// Real Gemini. Run by hand: GEMINI_LIVE=1 GEMINI_API_KEY=... (and start the server without GEMINI_FAKE).
// The sample videos are not in git, so the path is overridable.
const SAMPLE =
  process.env.LIVE_SAMPLE ?? "/Users/celsaad/projects/interviews/glasslake/samples/j45-pr-po-si.mp4";

test.skip(process.env.GEMINI_LIVE !== "1", "set GEMINI_LIVE=1 to run against real Gemini");

test("@live real Gemini finds at least 3 steps with timestamps inside the video", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  await page.goto("/");
  await uploadSample(page, SAMPLE);

  await expect(page.getByRole("status")).toContainText(/\d+ steps? ready/i, {
    timeout: 6 * 60_000,
  });
  const count = await page.getByRole("heading", { name: /^Step \d+$/ }).count();
  expect(count).toBeGreaterThanOrEqual(3);

  // Timestamp buttons show M:SS; the video is 2:44 long (164 s).
  const stamps = await page.getByRole("button", { name: /^\d+:\d{2}/ }).allInnerTexts();
  expect(stamps.length).toBeGreaterThanOrEqual(3);
  for (const text of stamps) {
    const [m, s] = text.trim().split(":").map(Number);
    expect(m * 60 + s).toBeLessThanOrEqual(164);
  }
});
