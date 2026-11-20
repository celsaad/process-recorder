// Captures UI states from a GEMINI_FAKE=1 production server. Usage: node shots.mjs <baseUrl> <repoRoot>
import { chromium } from "@playwright/test";
import { join } from "node:path";
const [base, root] = process.argv.slice(2);
const fx = (f) => join(root, "e2e/fixtures", f);
const out = (f) => join(root, "docs/screenshots", f);
const browser = await chromium.launch();
const settle = async (page, ms = 400) => {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() =>
    document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).every((a) => a.playState !== "running"),
  );
};
async function fresh(scenario = "happy") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "fake-scenario", value: scenario, url: base }]);
  const page = await ctx.newPage();
  await page.goto(base);
  return { ctx, page };
}
const upload = (page, file) => page.locator('input[type="file"]').first().setInputFiles(file);
const ready = (page) => page.getByRole("img", { name: /screenshot for step 4/i }).waitFor({ timeout: 30000 });

const shots = {
  "01-empty-state.png": async () => { const { ctx, page } = await fresh(); await settle(page); await page.screenshot({ path: out("01-empty-state.png") }); await ctx.close(); },
  "02-processing.png": async () => {
    const { ctx, page } = await fresh("slow"); await upload(page, fx("tiny.webm"));
    await page.getByRole("list", { name: /processing stages/i }).waitFor(); await page.waitForTimeout(2500);
    await page.screenshot({ path: out("02-processing.png") }); await ctx.close();
  },
  "03-editor.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("tiny.webm")); await ready(page); await settle(page, 800);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(5, 5);
    await page.screenshot({ path: out("03-editor.png"), fullPage: true }); await ctx.close();
  },
  "04-long-video-notice.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("long-5min.mp4")); await ready(page); await settle(page, 800);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: out("04-long-video-notice.png") }); await ctx.close();
  },
  "05-frame-picker.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("tiny.webm")); await ready(page);
    await page.getByRole("button", { name: /^pick frame for step 2/i }).click();
    await page.getByRole("dialog").waitFor(); await settle(page, 1200);
    await page.screenshot({ path: out("05-frame-picker.png") }); await ctx.close();
  },
  "06-highlight-editing.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("tiny.webm")); await ready(page); await settle(page, 600);
    const hl = page.getByRole("button", { name: /highlight on step 1 screenshot/i });
    await hl.focus(); await page.keyboard.press("ArrowRight"); await settle(page);
    await page.locator("article").first().screenshot({ path: out("06-highlight-editing.png") }); await ctx.close();
  },
  "07-inline-undo.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("tiny.webm")); await ready(page); await settle(page, 600);
    await page.getByRole("button", { name: /^delete step 2$/i }).click(); await settle(page);
    const undo = page.getByRole("button", { name: /^undo/i }); await undo.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -220)); await settle(page);
    await page.screenshot({ path: out("07-inline-undo.png") }); await ctx.close();
  },
  "08-export-options.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("tiny.webm")); await ready(page);
    await page.getByRole("button", { name: /^export options/i }).click(); await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: /add blank column/i }).click(); await settle(page);
    await page.screenshot({ path: out("08-export-options.png") }); await ctx.close();
  },
  "09-confirm-start-new.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("tiny.webm")); await ready(page);
    await page.getByRole("button", { name: /start new/i }).click(); await page.getByRole("alertdialog").waitFor(); await settle(page);
    await page.screenshot({ path: out("09-confirm-start-new.png") }); await ctx.close();
  },
  "10-error-unsupported-type.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("not-a-video.pdf"));
    await page.getByRole("heading", { level: 1 }).filter({ hasNotText: /process recorder/i }).first().waitFor(); await settle(page);
    await page.screenshot({ path: out("10-error-unsupported-type.png") }); await ctx.close();
  },
  "11-error-too-long.png": async () => {
    const { ctx, page } = await fresh(); await upload(page, fx("too-long-10m30.mp4"));
    await page.getByText(/10:30/).first().waitFor({ timeout: 15000 }); await settle(page);
    await page.screenshot({ path: out("11-error-too-long.png") }); await ctx.close();
  },
  "12-error-rate-limited.png": async () => {
    const { ctx, page } = await fresh("rate_limited"); await upload(page, fx("tiny.webm"));
    await page.getByRole("button", { name: /retry|try again/i }).waitFor({ timeout: 15000 }); await settle(page);
    await page.screenshot({ path: out("12-error-rate-limited.png") }); await ctx.close();
  },
  "13-error-not-screen-recording.png": async () => {
    const { ctx, page } = await fresh("not_screen_recording"); await upload(page, fx("tiny.webm"));
    await page.getByRole("button", { name: /choose another/i }).first().waitFor({ timeout: 15000 }); await settle(page);
    await page.screenshot({ path: out("13-error-not-screen-recording.png") }); await ctx.close();
  },
  "14-no-steps.png": async () => {
    const { ctx, page } = await fresh("no_steps"); await upload(page, fx("tiny.webm"));
    await page.getByRole("button", { name: /add a step manually/i }).waitFor({ timeout: 15000 }); await settle(page);
    await page.screenshot({ path: out("14-no-steps.png") }); await ctx.close();
  },
};
for (const [name, fn] of Object.entries(shots)) {
  try { await fn(); console.log("ok  ", name); } catch (e) { console.log("FAIL", name, String(e.message).split("\n")[0]); }
}
await browser.close();
