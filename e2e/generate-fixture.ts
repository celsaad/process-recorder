// Records e2e/fixtures/tiny.webm: a scripted, fictional "Create purchase order" form being
// filled in (about 20 s). Run with `pnpm e2e:fixture`. Chromium writes VP8 WebM.
import { chromium } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "tiny.webm");
const SIZE = { width: 640, height: 360 };

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font:14px system-ui,sans-serif;margin:0;background:#f3f4f6;color:#111}
  nav{background:#1e3a8a;color:#fff;padding:10px 16px;font-weight:600}
  main{padding:14px 20px}
  h1{font-size:18px;margin:0 0 12px}
  label{display:block;font-size:12px;margin:8px 0 2px}
  input,select{width:300px;padding:6px;border:1px solid #9ca3af;border-radius:4px;font-size:14px}
  button{margin-top:14px;padding:8px 16px;background:#1d5bd6;color:#fff;border:0;border-radius:4px;font-size:14px}
  #status{margin-top:12px;font-weight:600;color:#166534}
</style></head><body>
<nav>Acme Purchasing</nav>
<main>
  <h1>New Purchase Order</h1>
  <label for="s">Supplier</label><input id="s" autocomplete="off">
  <label for="i">Item</label><input id="i" autocomplete="off">
  <label for="q">Quantity</label><input id="q" autocomplete="off">
  <label for="p">Unit price</label><input id="p" autocomplete="off">
  <button id="submit" type="button">Submit for approval</button>
  <div id="status"></div>
</main>
<script>document.getElementById('submit').onclick=()=>{document.getElementById('status').textContent='Status: Pending approval'}</script>
</body></html>`;

const FIELDS = [
  ["#s", "Northwind Office Supply"],
  ["#i", "A4 copy paper, 80 gsm"],
  ["#q", "20"],
  ["#p", "34.50"],
] as const;

const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), "fixture-"));
try {
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir, size: SIZE },
  });
  const page = await context.newPage();
  await page.setContent(HTML);
  await page.waitForTimeout(2500);
  for (const [selector, text] of FIELDS) {
    await page.click(selector);
    await page.waitForTimeout(1200);
    await page.type(selector, text, { delay: 120 });
    await page.waitForTimeout(1500);
  }
  await page.click("#submit");
  await page.waitForTimeout(3000);
  const video = page.video();
  await context.close();
  mkdirSync(dirname(OUT), { recursive: true });
  copyFileSync(await video!.path(), OUT);
  console.log(`Wrote ${OUT}`);
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
