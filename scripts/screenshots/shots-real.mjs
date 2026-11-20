// Editor-state screenshots from ONE real Gemini analysis of our synthetic tiny.webm.
import { chromium } from "@playwright/test";
import { join } from "node:path";
const [base, root] = process.argv.slice(2);
const out = (f) => join(root, "docs/screenshots", f);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
const settle = async (ms = 500) => {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).every((a) => a.playState !== "running"));
};
const step = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { console.log("FAIL", name, String(e.message).split("\n")[0]); } };
await page.goto(base);
const t0 = Date.now();
await page.locator('input[type="file"]').first().setInputFiles(join(root, "e2e/fixtures/tiny.webm"));
await page.getByRole("heading", { name: /^step 1$/i }).waitFor({ timeout: 180000 });
// wait for every step to have a screenshot
await page.waitForFunction(() => {
  const arts = [...document.querySelectorAll("article")];
  return arts.length > 0 && arts.every((a) => a.querySelector('img[alt^="Screenshot for step"]'));
}, null, { timeout: 60000 });
console.log("steps", await page.locator("article").count(), "in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
await settle(800);
await step("03-editor.png", async () => {
  await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(5, 5);
  await page.screenshot({ path: out("03-editor.png"), fullPage: true });
});
await step("06-highlight-editing.png", async () => {
  const hl = page.getByRole("button", { name: /highlight on step \d+ screenshot/i }).first();
  await hl.focus(); await settle();
  await hl.locator("xpath=ancestor::article").screenshot({ path: out("06-highlight-editing.png") });
});
await step("05-frame-picker.png", async () => {
  await page.getByRole("button", { name: /^pick frame for step 2/i }).click();
  await page.getByRole("dialog").waitFor(); await settle(1500);
  await page.screenshot({ path: out("05-frame-picker.png") });
  await page.keyboard.press("Escape"); await settle();
});
await step("08-export-options.png", async () => {
  await page.getByRole("button", { name: /^export options/i }).click(); await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: /add blank column/i }).click();
  await page.getByRole("textbox", { name: /header for blank column/i }).fill("Pass/Fail"); await settle();
  await page.screenshot({ path: out("08-export-options.png") });
  await page.keyboard.press("Escape"); await settle();
});
await step("07-inline-undo.png", async () => {
  await page.getByRole("button", { name: /^delete step 2$/i }).click(); await settle();
  await page.getByRole("button", { name: /^undo/i }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -260)); await settle();
  await page.screenshot({ path: out("07-inline-undo.png") });
  await page.getByRole("button", { name: /^undo/i }).click(); await settle();
});
await step("09-confirm-start-new.png", async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: /start new/i }).click(); await page.getByRole("alertdialog").waitFor(); await settle();
  await page.screenshot({ path: out("09-confirm-start-new.png") });
});
await browser.close();
