// Lane C. Word export (D11). Layout follows the WordExport board: A4 landscape, title, 5-column table.
import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  Document,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { renderForExport, type ExportImage } from "./image";
import type { Project, Step } from "./types";

export type GetShot = (stepId: string) => Promise<Blob | null>;

export const HEADERS = ["#", "Action", "Description", "Expected result", "Screenshot"] as const;
export const NO_SHOT_TEXT = "No screenshot";
const FALLBACK_NAME = "test-script";

const FONT = "Calibri";
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "6B7280" } as const;
// The board lays the page out in CSS px at 96 dpi; Word measures in twips (1/1440 in).
const PX = 15;
const MARGIN_TWIPS = 850;
const PAGE_WIDTH_TWIPS = 16838; // A4 long edge
const PAGE_HEIGHT_TWIPS = 11906; // A4 short edge
const CONTENT_TWIPS = PAGE_WIDTH_TWIPS - 2 * MARGIN_TWIPS;
const COLUMN_TWIPS = (() => {
  const fixed = [44, 180, 260, 0, 280].map((px) => px * PX);
  fixed[3] = CONTENT_TWIPS - fixed.reduce((a, b) => a + b, 0);
  return fixed;
})();
/** Screenshot width in CSS px: the 280 px column minus its 10 px cell padding on each side, rounded. */
const SHOT_WIDTH_PX = 258;

export type RowModel = {
  stepId: string;
  /** "1", action, description, expected result */
  texts: [string, string, string, string];
  /** Alt text for step N's screenshot, or null when the cell is a placeholder. */
  shot: { image: ExportImage; alt: string } | null;
};

/** Pure mapping from steps (in order) and their rendered images to table rows. */
export function mapRows(steps: Step[], images: (ExportImage | null)[]): RowModel[] {
  return steps.map((step, i) => {
    const image = images[i] ?? null;
    return {
      stepId: step.id,
      texts: [String(i + 1), step.action, step.description, step.expectedResult],
      shot: image ? { image, alt: `Screenshot for step ${i + 1}` } : null,
    };
  });
}

function cell(children: Paragraph[], widthTwips: number, extra: { shaded?: boolean } = {}): TableCell {
  return new TableCell({
    children,
    width: { size: widthTwips, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
    ...(extra.shaded ? { shading: { type: ShadingType.CLEAR, fill: "E7EAEE", color: "auto" } } : {}),
  });
}

function textParagraph(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, bold, font: FONT, size: 24 })] });
}

function headerRow(): TableRow {
  return new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: HEADERS.map((h, i) => cell([textParagraph(h, true)], COLUMN_TWIPS[i], { shaded: true })),
  });
}

function shotParagraph(shot: RowModel["shot"]): Paragraph {
  if (!shot) return new Paragraph({ children: [new TextRun({ text: NO_SHOT_TEXT, italics: true, color: "5A6370", font: FONT, size: 24 })] });
  const { image, alt } = shot;
  const height = Math.max(1, Math.round((SHOT_WIDTH_PX * image.height) / image.width));
  return new Paragraph({
    children: [
      new ImageRun({
        type: "jpg",
        data: image.bytes,
        transformation: { width: SHOT_WIDTH_PX, height },
        altText: { name: alt, description: alt, title: alt },
      }),
    ],
  });
}

function bodyRow(row: RowModel): TableRow {
  const [n, action, description, expected] = row.texts;
  return new TableRow({
    cantSplit: true,
    children: [
      cell([textParagraph(n)], COLUMN_TWIPS[0]),
      cell([textParagraph(action, true)], COLUMN_TWIPS[1]),
      cell([textParagraph(description)], COLUMN_TWIPS[2]),
      cell([textParagraph(expected)], COLUMN_TWIPS[3]),
      cell([shotParagraph(row.shot)], COLUMN_TWIPS[4]),
    ],
  });
}

/** Landscape, title, 5-column table. Highlights are burned into the screenshots. */
export async function buildDocx(project: Project, steps: Step[], getShot: GetShot): Promise<Blob> {
  const images: (ExportImage | null)[] = [];
  // One at a time: each export render holds a full-size bitmap and canvas.
  for (const step of steps) {
    const shot = step.captureState === "failed" ? null : await getShot(step.id);
    images.push(shot ? await renderForExport(shot, step.highlight) : null);
  }
  const rows = mapRows(steps, images);

  const doc = new Document({
    title: project.title,
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE, width: PAGE_HEIGHT_TWIPS, height: PAGE_WIDTH_TWIPS },
            margin: { top: MARGIN_TWIPS, bottom: MARGIN_TWIPS, left: MARGIN_TWIPS, right: MARGIN_TWIPS },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            spacing: { after: 300 },
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: project.title, bold: true, font: FONT, size: 45 })],
          }),
          new Table({
            width: { size: CONTENT_TWIPS, type: WidthType.DXA },
            columnWidths: COLUMN_TWIPS,
            layout: TableLayoutType.FIXED,
            rows: [headerRow(), ...rows.map(bodyRow)],
          }),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "Create a purchase order" → "create-a-purchase-order.docx"; empty → "test-script.docx". */
export function exportFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || FALLBACK_NAME}.docx`;
}
