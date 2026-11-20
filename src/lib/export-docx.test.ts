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
});
