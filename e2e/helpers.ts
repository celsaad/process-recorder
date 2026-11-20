import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { join } from "node:path";

// Playwright runs from the repo root.
const here = join(process.cwd(), "e2e");

export const BASE_URL = "http://localhost:3100";
export const TINY_VIDEO = join(here, "fixtures", "tiny.webm");
export const NOT_A_VIDEO = join(here, "fixtures", "not-a-video.pdf");

export type Scenario =
  | "happy"
  | "no_steps"
  | "not_screen_recording"
  | "rate_limited"
  | "bad_model_output"
  | "gemini_failed"
  | "slow";

/** Picks the fake Gemini scenario (ignored by the server unless GEMINI_FAKE=1). Call before page.goto. */
export async function useScenario(page: Page, name: Scenario): Promise<void> {
  await page.context().addCookies([{ name: "fake-scenario", value: name, url: BASE_URL }]);
}

/** Chooses a file through the (hidden) file input behind the dropzone. */
export async function uploadSample(page: Page, file: string = TINY_VIDEO): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(file);
}

/** Waits until the editor is ready: the "N steps ready" announcement and a first step card. */
export async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByRole("status")).toContainText(/\d+ steps? ready/i, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Step 1" })).toBeVisible();
}

/** WCAG 2.2 AA scan of the whole page. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, "axe violations").toEqual([]);
}
