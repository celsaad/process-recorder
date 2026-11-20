import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { RESULTS_HEADING_ID } from "../src/lib/ui-contracts";
import type { FakeScenario } from "../src/server/gemini-fake";

export { RESULTS_HEADING_ID };
export type Scenario = FakeScenario;

export const BASE_URL = "http://localhost:3100";
// Playwright runs from the repo root.
const fixtures = join(process.cwd(), "e2e", "fixtures");
export const TINY_WEBM = join(fixtures, "tiny.webm");
export const TINY_MP4 = join(fixtures, "tiny.mp4");
export const LONG_5MIN = join(fixtures, "long-5min.mp4");
export const TOO_LONG = join(fixtures, "too-long-10m30.mp4");
export const CORRUPT = join(fixtures, "corrupt.mp4");
export const NOT_A_VIDEO = join(fixtures, "not-a-video.pdf");

/** Picks the fake Gemini scenario (ignored by the server unless GEMINI_FAKE=1). Call before page.goto. */
export async function useScenario(page: Page, name: Scenario): Promise<void> {
  await page.context().addCookies([{ name: "fake-scenario", value: name, url: BASE_URL }]);
}

/** Chooses a file through the hidden file input behind the dropzone. */
export async function uploadSample(page: Page, file: string = TINY_WEBM): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(file);
}

/** Records every request to /api/upload, so specs can assert "no upload happened". */
export function trackUploads(page: Page): string[] {
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/upload")) uploads.push(r.url());
  });
  return uploads;
}

/** Waits until the editor is ready: the "N steps ready" announcement and a first step card. */
export async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByRole("status")).toContainText(/\d+ steps? ready/i, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Step 1" })).toBeVisible();
}

/**
 * Presses Tab (a bounded number of times) until `target` has focus. Returns how many presses it
 * took. Use it in sequence to assert tab order: each call continues from where the last stopped.
 */
export async function tabTo(page: Page, target: Locator, max = 40): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Tab");
    const focused = await target
      .first()
      .evaluate((el) => el === document.activeElement, undefined, { timeout: 1000 })
      .catch(() => false);
    if (focused) return i;
  }
  throw new Error(`Tab did not reach ${target} within ${max} presses`);
}

/**
 * Polls IndexedDB (idb-keyval defaults: DB "keyval-store", store "keyval", key "project") until the
 * stored project JSON contains `text`. Use before a reload so it can't race the 500 ms save debounce.
 */
export async function expectProjectStored(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open("keyval-store");
              open.onsuccess = () => {
                const get = open.result.transaction("keyval").objectStore("keyval").get("project");
                get.onsuccess = () => resolve(JSON.stringify(get.result ?? null));
              };
            }),
        ),
      { timeout: 5000 },
    )
    .toContain(text);
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
