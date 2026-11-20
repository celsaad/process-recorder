import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { fixtureProject, fixtureSteps } from "@/fixtures/project";
import { buildDocx, exportFilename, mapRows, NO_SHOT_TEXT } from "./export-docx";
import type { ExportImage } from "./image";

vi.mock("./image", () => ({
  renderForExport: vi.fn(async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 1600, height: 1000 })),
}));

const img: ExportImage = { bytes: new Uint8Array([1]), width: 1600, height: 1000 };

describe("exportFilename", () => {
  it("slugs the title", () => {
    expect(exportFilename("Create a purchase order")).toBe("create-a-purchase-order.docx");
    expect(exportFilename("  Spaces   &  symbols!! ")).toBe("spaces-symbols.docx");
  });
  it("strips diacritics from unicode", () => {
    expect(exportFilename("Café Résumé")).toBe("cafe-resume.docx");
  });
  it("falls back when nothing usable is left", () => {
    expect(exportFilename("")).toBe("test-script.docx");
    expect(exportFilename("   ")).toBe("test-script.docx");
    expect(exportFilename("日本語")).toBe("test-script.docx");
  });
  it("caps the length without leaving a trailing dash", () => {
    const name = exportFilename(`${"word ".repeat(30)}end`);
    expect(name.endsWith(".docx")).toBe(true);
    expect(name.slice(0, -5).length).toBeLessThanOrEqual(60);
    expect(name).not.toMatch(/-\.docx$/);
  });
});

describe("mapRows", () => {
  it("makes one row per step in order with 5 columns of content", () => {
    const rows = mapRows(fixtureSteps, [img, img, img, img]);
    expect(rows.map((r) => r.stepId)).toEqual(fixtureSteps.map((s) => s.id));
    expect(rows[0].texts).toEqual(["1", fixtureSteps[0].action, fixtureSteps[0].description, fixtureSteps[0].expectedResult]);
    expect(rows[3].texts[0]).toBe("4");
    expect(rows[1].shot).toEqual({ image: img, alt: "Screenshot for step 2" });
  });
  it("uses a placeholder cell when a shot is missing", () => {
    const rows = mapRows(fixtureSteps.slice(0, 2), [img, null]);
    expect(rows[0].shot).not.toBeNull();
    expect(rows[1].shot).toBeNull();
    expect(NO_SHOT_TEXT).toBe("No screenshot");
  });
});

describe("buildDocx", () => {
  it("produces a docx (zip) blob, skipping missing and failed shots", async () => {
    const steps = fixtureSteps.map((s, i) => (i === 3 ? { ...s, captureState: "failed" as const } : s));
    const getShot = vi.fn(async (id: string) => (id === "step-2" ? null : new Blob(["x"], { type: "image/webp" })));
    const blob = await buildDocx(fixtureProject, steps, getShot);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 2);
    expect(Array.from(head)).toEqual([0x50, 0x4b]); // "PK"
    expect(getShot).not.toHaveBeenCalledWith("step-4");
  });

  it("lays out a landscape page with a 5-column table: header + one row per step, placeholders for missing shots", async () => {
    const steps = fixtureSteps.map((s, i) => (i === 3 ? { ...s, captureState: "failed" as const } : s));
    const getShot = async (id: string) => (id === "step-2" ? null : new Blob(["x"], { type: "image/webp" }));
    const blob = await buildDocx(fixtureProject, steps, getShot);
    const xml = unzip(new Uint8Array(await blob.arrayBuffer()))["word/document.xml"];
    expect(xml).toBeDefined();

    const pgSz = /<w:pgSz [^>]*\/>/.exec(xml)?.[0] ?? "";
    expect(pgSz).toContain('w:orient="landscape"');
    const [w, h] = [/w:w="(\d+)"/, /w:h="(\d+)"/].map((re) => Number(re.exec(pgSz)?.[1]));
    expect(w).toBeGreaterThan(h);

    const grid = /<w:tblGrid>([^]*?)<\/w:tblGrid>/.exec(xml)?.[1] ?? "";
    expect(grid.match(/<w:gridCol\b/g)).toHaveLength(5);

    const rows = xml.split(/<w:tr[\s>]/).slice(1);
    expect(rows).toHaveLength(steps.length + 1);
    expect(rows[0]).toContain("<w:tblHeader");
    for (const header of ["Action", "Description", "Expected result", "Screenshot"]) expect(rows[0]).toContain(`>${header}<`);
    const xmlText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;").replace(/"/g, "&quot;");
    rows.slice(1).forEach((row, i) => expect(row).toContain(`>${xmlText(steps[i].action)}<`));

    // step-2 has no stored shot and step-4 failed: placeholders. The other two get images.
    const withPlaceholder = rows.slice(1).map((row) => row.includes(`>${NO_SHOT_TEXT}<`));
    expect(withPlaceholder).toEqual([false, true, false, true]);
    expect(rows.slice(1).map((row) => row.includes("<w:drawing>"))).toEqual([true, false, true, false]);
  });
});

/** Minimal zip reader (stored + deflate) over the central directory, enough for a docx. */
function unzip(zip: Uint8Array): Record<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = zip.subarray(start, start + size);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (data) out[name] = new TextDecoder().decode(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
