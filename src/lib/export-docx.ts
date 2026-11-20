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
import { DEFAULT_TEMPLATE, visibleColumns, type ColumnKind, type ExportTemplate, type TemplateColumn } from "./export-template";
import type { Project, Step } from "./types";

export type GetShot = (stepId: string) => Promise<Blob | null>;

/** Default headers, in default order (DEFAULT_TEMPLATE). */
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
const SHOT_COLUMN_TWIPS = 280 * PX;
/** Relative widths of the non-screenshot columns. The default five reproduce the board: 44, 180, 260 px, rest. */
const WEIGHT_TWIPS: Record<Exclude<ColumnKind, "screenshot">, number> = {
  number: 44 * PX,
  action: 180 * PX,
  description: 260 * PX,
  expectedResult: CONTENT_TWIPS - (44 + 180 + 260 + 280) * PX,
  blank: 120 * PX,
};

/**
 * Column widths in twips for the visible columns. The screenshot column keeps its fixed 280 px
 * (unless it's alone); the others split the rest in proportion to their weights. The total is
 * always exactly CONTENT_TWIPS (rounding drift goes to the widest flexible column).
 */
export function columnWidths(columns: TemplateColumn[]): number[] {
  const flex = columns.filter((c) => c.kind !== "screenshot");
  const hasShot = flex.length < columns.length;
  if (flex.length === 0) return columns.map(() => CONTENT_TWIPS);
  const available = CONTENT_TWIPS - (hasShot ? SHOT_COLUMN_TWIPS : 0);
  const weight = (c: TemplateColumn) => WEIGHT_TWIPS[c.kind as Exclude<ColumnKind, "screenshot">];
  const totalWeight = flex.reduce((a, c) => a + weight(c), 0);
  const widths = columns.map((c) =>
    c.kind === "screenshot" ? SHOT_COLUMN_TWIPS : Math.round((weight(c) * available) / totalWeight),
  );
  const drift = CONTENT_TWIPS - widths.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    let widest = -1;
    columns.forEach((c, i) => {
      if (c.kind !== "screenshot" && (widest < 0 || widths[i] > widths[widest])) widest = i;
    });
    widths[widest] += drift;
  }
  return widths;
}
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

function headerRow(columns: TemplateColumn[], widths: number[]): TableRow {
  return new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: columns.map((c, i) => cell([textParagraph(c.header, true)], widths[i], { shaded: true })),
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

function bodyCell(row: RowModel, kind: ColumnKind): Paragraph {
  const [n, action, description, expected] = row.texts;
  switch (kind) {
    case "number":
      return textParagraph(n);
    case "action":
      return textParagraph(action, true);
    case "description":
      return textParagraph(description);
    case "expectedResult":
      return textParagraph(expected);
    case "screenshot":
      return shotParagraph(row.shot);
    case "blank":
      // Left empty for testers to fill in.
      return new Paragraph({});
  }
}

function bodyRow(row: RowModel, columns: TemplateColumn[], widths: number[]): TableRow {
  return new TableRow({
    cantSplit: true,
    children: columns.map((c, i) => cell([bodyCell(row, c.kind)], widths[i])),
  });
}

/**
 * Landscape, title, then a table with the template's visible columns in order (default: the
 * 5 board columns). Highlights are burned into the screenshots; without a visible screenshot
 * column no shots are read or rendered.
 */
export async function buildDocx(
  project: Project,
  steps: Step[],
  getShot: GetShot,
  template: ExportTemplate = DEFAULT_TEMPLATE,
): Promise<Blob> {
  const visible = visibleColumns(template);
  const columns = visible.length > 0 ? visible : visibleColumns(DEFAULT_TEMPLATE);
  const widths = columnWidths(columns);
  const wantShots = columns.some((c) => c.kind === "screenshot");
  const images: (ExportImage | null)[] = [];
  // One at a time: each export render holds a full-size bitmap and canvas.
  for (const step of steps) {
    if (!wantShots) {
      images.push(null);
      continue;
    }
    try {
      const shot = step.captureState === "failed" ? null : await getShot(step.id);
      images.push(shot ? await renderForExport(shot, step.highlight) : null);
    } catch {
      // One unreadable or corrupt shot must not fail the whole export; it gets the placeholder cell.
      images.push(null);
    }
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
            columnWidths: widths,
            layout: TableLayoutType.FIXED,
            rows: [headerRow(columns, widths), ...rows.map((r) => bodyRow(r, columns, widths))],
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
