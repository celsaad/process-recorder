// Generates src/fixtures/shots/step-{1..4}.webp: fictional "purchase order" screens, 1600×1000.
// Usage: node scripts/make-fixture-shots.mjs   (uses Playwright's Chromium; no extra deps)
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const OUT = fileURLToPath(new URL("../src/fixtures/shots/", import.meta.url));
const W = 1600;
const H = 1000;

const css = `
* { box-sizing: border-box; margin: 0; }
body { width: ${W}px; height: ${H}px; font: 15px/1.4 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  color: #1f2933; background: #eef1f5; overflow: hidden; }
.top { height: 56px; background: #243b53; color: #fff; display: flex; align-items: center; padding: 0 28px; gap: 32px; }
.logo { font-weight: 700; font-size: 18px; letter-spacing: .5px; }
.nav span { margin-right: 22px; opacity: .8; } .nav .on { opacity: 1; border-bottom: 2px solid #fff; padding-bottom: 4px; }
.page { padding: 28px 128px; }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
h1 { font-size: 26px; font-weight: 600; }
.btn { display: inline-block; padding: 10px 18px; border-radius: 6px; border: 1px solid #9aa5b1; background: #fff; font-weight: 600; }
.btn.primary { background: #2f6fde; border-color: #2f6fde; color: #fff; }
.card { background: #fff; border: 1px solid #d9dee5; border-radius: 8px; padding: 22px 26px; margin-bottom: 18px; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px 28px; }
.f label { display: block; font-size: 13px; color: #52606d; margin-bottom: 6px; }
.f div { height: 40px; border: 1px solid #bcc5cf; border-radius: 6px; padding: 9px 12px; background: #fff; }
.f div.focus { border: 2px solid #2f6fde; }
.f div.empty { color: #9aa5b1; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid #e4e7eb; }
th { font-size: 13px; color: #52606d; font-weight: 600; background: #f5f7fa; }
td.n, th.n { text-align: right; }
.list td { height: 46px; }
.status { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 13px; background: #e1effe; color: #1c4f9c; }
.status.wait { background: #fff3c4; color: #7a5c00; }
.banner { background: #e3f9e5; border: 1px solid #57ae5b; color: #0e5814; padding: 14px 18px; border-radius: 8px; margin-bottom: 18px; font-weight: 600; }
.menu { position: absolute; left: 228px; top: 330px; width: 600px; background: #fff; border: 1px solid #bcc5cf;
  border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.15); }
.menu div { padding: 10px 14px; } .menu .hl { background: #e1effe; }
.total { text-align: right; font-size: 18px; font-weight: 600; margin-top: 14px; }
.foot { display: flex; justify-content: flex-end; gap: 12px; }
`;

const top = `<div class="top"><span class="logo">ACME ERP</span><div class="nav">
  <span>Home</span><span class="on">Purchasing</span><span>Inventory</span><span>Finance</span><span>Reports</span></div></div>`;

const field = (label, value, cls = "") => `<div class="f"><label>${label}</label><div class="${cls}">${value}</div></div>`;

const header = (supplier, supplierCls = "") => `<div class="card"><div class="grid">
  ${field("Supplier", supplier, supplierCls)}
  ${field("Order date", "20 Nov 2026")}
  ${field("Currency", "USD")}
  ${field("Payment terms", supplier.startsWith("Northwind") ? "Net 30" : "—", supplier.startsWith("Northwind") ? "" : "empty")}
  ${field("Ship-to", supplier.startsWith("Northwind") ? "Main Warehouse" : "—", supplier.startsWith("Northwind") ? "" : "empty")}
  ${field("Buyer", "Dana Whitfield")}
</div></div>`;

const lines = (rows, totalText) => `<div class="card"><div class="head" style="margin-bottom:12px">
  <h2 style="font-size:18px">Lines</h2><span class="btn">+ Add line</span></div>
  <table><tr><th>#</th><th>Item</th><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Line total</th></tr>
  ${rows || `<tr><td colspan="6" style="color:#9aa5b1;text-align:center;padding:26px">No lines yet</td></tr>`}</table>
  <div class="total">Order total: ${totalText}</div></div>`;

const paperRow = `<tr><td>1</td><td>PAP-A4-80</td><td>A4 copy paper, 80 gsm</td><td class="n">20</td><td class="n">34.50</td><td class="n">690.00</td></tr>`;

const formPage = (title, body, extra = "") => `${top}<div class="page">
  <div class="head"><h1>${title}</h1><span class="status">Draft</span></div>${body}${extra}</div>`;

const shots = [
  // 1: PO list with the "New Order" button
  `${top}<div class="page"><div class="head"><h1>Purchase Orders</h1><span class="btn primary">+ New Order</span></div>
  <div class="card list"><table><tr><th>PO number</th><th>Supplier</th><th>Order date</th><th class="n">Total</th><th>Status</th></tr>
  ${[
    ["PO-2024-00186", "Contoso Industrial", "18 Nov 2026", "12,480.00", "Approved"],
    ["PO-2024-00185", "Fabrikam Packaging", "17 Nov 2026", "3,215.40", "Received"],
    ["PO-2024-00184", "Northwind Office Supply", "14 Nov 2026", "842.10", "Pending approval"],
    ["PO-2024-00183", "Litware Components", "12 Nov 2026", "27,900.00", "Approved"],
    ["PO-2024-00182", "Tailspin Logistics", "11 Nov 2026", "1,150.00", "Closed"],
    ["PO-2024-00181", "Contoso Industrial", "07 Nov 2026", "9,604.75", "Received"],
    ["PO-2024-00180", "Adventure Works Tools", "05 Nov 2026", "4,388.00", "Closed"],
  ]
    .map(
      ([n, s, d, t, st]) =>
        `<tr><td>${n}</td><td>${s}</td><td>${d}</td><td class="n">${t}</td><td><span class="status${st === "Pending approval" ? " wait" : ""}">${st}</span></td></tr>`,
    )
    .join("")}</table></div></div>`,
  // 2: new PO, supplier dropdown open
  formPage(
    "New Purchase Order",
    header("North", "focus") + lines("", "0.00 USD"),
    `<div class="menu"><div class="hl"><b>North</b>wind Office Supply (V-10482)</div><div><b>North</b>gate Electrical (V-20931)</div><div><b>North</b> Star Freight (V-11877)</div></div>`,
  ),
  // 3: line added
  formPage("New Purchase Order", header("Northwind Office Supply (V-10482)") + lines(paperRow, "690.00 USD")),
  // 4: submitted
  `${top}<div class="page"><div class="banner">✓ PO-2024-00187 submitted for approval</div>
  <div class="head"><h1>PO-2024-00187</h1><span class="status wait">Pending approval</span></div>
  ${header("Northwind Office Supply (V-10482)")}${lines(paperRow, "690.00 USD")}
  <div class="foot"><span class="btn">Save draft</span><span class="btn primary">Submit for approval</span></div></div>`,
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await mkdir(OUT, { recursive: true });
  for (const [i, body] of shots.entries()) {
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`);
    const png = await page.screenshot({ type: "png" });
    // Chromium encodes WebP from a canvas; Playwright's screenshot API can't.
    const webpBase64 = await page.evaluate(async (pngBase64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${pngBase64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/webp", 0.9).split(",")[1];
    }, png.toString("base64"));
    const file = `${OUT}step-${i + 1}.webp`;
    const bytes = Buffer.from(webpBase64, "base64");
    await writeFile(file, bytes);
    console.log(`${file} (${Math.round(bytes.length / 1024)} KB)`);
  }
} finally {
  await browser.close();
}
