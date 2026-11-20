import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { fixtureProject, fixtureSteps } from "@/fixtures/project";
import { buildDocx, columnWidths } from "./export-docx";
import {
  addBlankColumn,
  DEFAULT_TEMPLATE,
  moveColumn,
  renameColumn,
  toggleColumn,
  visibleColumns,
  type ExportTemplate,
} from "./export-template";

vi.mock("./image", () => ({
  renderForExport: vi.fn(async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 1600, height: 1000 })),
}));

const CONTENT_TWIPS = 16838 - 2 * 850;

/** Reads word/document.xml out of the .docx zip (central directory walk; stored or deflated). */
async function documentXml(blob: Blob): Promise<string> {
  const buf = Buffer.from(await blob.arrayBuffer());
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const local = buf.readUInt32LE(p + 42);
    if (name === "word/document.xml") {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  throw new Error("word/document.xml not found");
}

const shot = () => vi.fn(async () => new Blob(["x"], { type: "image/webp" }));

/** Header-row texts, in order: the first table row's cell texts. */
function headerTexts(xml: string): string[] {
  const firstRow = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)?.[0] ?? "";
  return [...firstRow.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) =>
    [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
  );
}

function gridWidths(xml: string): number[] {
  return [...(xml.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)?.[0] ?? "").matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
}

describe("columnWidths", () => {
  it("reproduces the board widths for the default template", () => {
    expect(columnWidths(DEFAULT_TEMPLATE.columns)).toEqual([660, 2700, 3900, 3678, 4200]);
  });
  it("keeps the screenshot column at 280 px and always sums to the content width", () => {
    let t: ExportTemplate = DEFAULT_TEMPLATE;
    for (let i = 0; i < 4; i++) t = addBlankColumn(t, `B${i}`, `b${i}`);
    const w = columnWidths(visibleColumns(t));
    expect(w.reduce((a, b) => a + b, 0)).toBe(CONTENT_TWIPS);
    expect(w[4]).toBe(4200);
    const noShot = columnWidths(visibleColumns(toggleColumn(DEFAULT_TEMPLATE, "screenshot", false)));
    expect(noShot.reduce((a, b) => a + b, 0)).toBe(CONTENT_TWIPS);
    expect(columnWidths([{ id: "s", kind: "screenshot", header: "S", visible: true }])).toEqual([CONTENT_TWIPS]);
  });
});

describe("buildDocx with a template", () => {
  it("default template: the 5 board headers and widths (same as no template)", async () => {
    const xml = await documentXml(await buildDocx(fixtureProject, fixtureSteps, shot()));
    expect(headerTexts(xml)).toEqual(["#", "Action", "Description", "Expected result", "Screenshot"]);
    expect(gridWidths(xml)).toEqual([660, 2700, 3900, 3678, 4200]);
    const withDefault = await documentXml(await buildDocx(fixtureProject, fixtureSteps, shot(), DEFAULT_TEMPLATE));
    // docx numbers drawings with a process-wide counter; everything else must match.
    const norm = (s: string) => s.replace(/(docPr id|cNvPr id)="\d+"/g, "$1=\"_\"");
    expect(norm(withDefault)).toBe(norm(xml));
  });

  it("renders columns in the template's order", async () => {
    let t = moveColumn(DEFAULT_TEMPLATE, "screenshot", -1); // # Action Description Screenshot Expected
    t = moveColumn(t, "number", 1); // Action # ...
    const xml = await documentXml(await buildDocx(fixtureProject, fixtureSteps, shot(), t));
    expect(headerTexts(xml)).toEqual(["Action", "#", "Description", "Screenshot", "Expected result"]);
    const w = gridWidths(xml);
    expect(w[3]).toBe(4200);
    expect(w.reduce((a, b) => a + b, 0)).toBe(CONTENT_TWIPS);
  });

  it("a hidden screenshot column fetches no images and has no drawing", async () => {
    const getShot = shot();
    const t = toggleColumn(DEFAULT_TEMPLATE, "screenshot", false);
    const xml = await documentXml(await buildDocx(fixtureProject, fixtureSteps, getShot, t));
    expect(getShot).not.toHaveBeenCalled();
    expect(xml).not.toContain("<w:drawing>");
    expect(xml).not.toContain("No screenshot");
    expect(headerTexts(xml)).toEqual(["#", "Action", "Description", "Expected result"]);
    expect(gridWidths(xml).reduce((a, b) => a + b, 0)).toBe(CONTENT_TWIPS);
  });

  it("throws on a template with no visible columns (the UI and storage never produce one)", async () => {
    const none = { columns: DEFAULT_TEMPLATE.columns.map((c) => ({ ...c, visible: false })) };
    await expect(buildDocx(fixtureProject, fixtureSteps, shot(), none)).rejects.toThrow(/no visible columns/);
  });

  it("uses renamed headers", async () => {
    const t = renameColumn(DEFAULT_TEMPLATE, "expectedResult", "Expected outcome");
    const xml = await documentXml(await buildDocx(fixtureProject, fixtureSteps, shot(), t));
    expect(headerTexts(xml)).toContain("Expected outcome");
    expect(headerTexts(xml)).not.toContain("Expected result");
  });

  it("blank columns get a header and empty body cells", async () => {
    let t = addBlankColumn(DEFAULT_TEMPLATE, "Pass/Fail", "pf");
    t = addBlankColumn(t, "Tester", "tester");
    const xml = await documentXml(await buildDocx(fixtureProject, fixtureSteps, shot(), t));
    expect(headerTexts(xml).slice(-2)).toEqual(["Pass/Fail", "Tester"]);
    const rows = [...xml.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
    expect(rows).toHaveLength(fixtureSteps.length + 1);
    for (const row of rows.slice(1)) {
      const cells = [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
      expect(cells).toHaveLength(7);
      expect(cells[5]).not.toMatch(/<w:t[ >]/);
      expect(cells[6]).not.toMatch(/<w:t[ >]/);
    }
    expect(gridWidths(xml).reduce((a, b) => a + b, 0)).toBe(CONTENT_TWIPS);
  });
});
