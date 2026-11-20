// A realistic 4-step project for dev pages, tests and Lane F before the merge.
import type { Project, Step } from "@/lib/types";

const steps: Step[] = [
  {
    id: "step-1",
    action: "Open Purchasing → Purchase Orders and click 'New Order'",
    description:
      "From the main navigation, open the Purchasing module, choose Purchase Orders, then click the 'New Order' button in the top-right corner of the list.",
    expectedResult: "A blank 'New Purchase Order' form opens with today's date in Order Date.",
    timestampSec: 4,
    captureState: "ok",
    highlight: { x: 0.85, y: 0.075, w: 0.075, h: 0.055 },
    highlightSource: "gemini",
    suggestedHighlight: { x: 0.85, y: 0.075, w: 0.075, h: 0.055 },
  },
  {
    id: "step-2",
    action: "Select supplier 'Northwind Office Supply'",
    description:
      "Click the Supplier field, type 'North', and pick 'Northwind Office Supply (V-10482)' from the suggestions.",
    expectedResult:
      "The supplier is filled in, and Payment Terms and Ship-to Address default from the supplier record (Net 30, Main Warehouse).",
    timestampSec: 17.5,
    captureState: "ok",
    highlight: { x: 0.09, y: 0.18, w: 0.27, h: 0.055 },
    highlightSource: "gemini",
    suggestedHighlight: { x: 0.09, y: 0.18, w: 0.27, h: 0.055 },
  },
  {
    id: "step-3",
    action: "Add a line: item 'A4 copy paper, 80 gsm', quantity 20, unit price 34.50",
    description:
      "In the Lines section, click 'Add line', choose item PAP-A4-80 'A4 copy paper, 80 gsm', enter 20 in Quantity and 34.50 in Unit Price, then press Tab.",
    expectedResult: "The line total shows 690.00 and the order total updates to 690.00 USD.",
    timestampSec: 41,
    captureState: "ok",
    highlight: { x: 0.09, y: 0.465, w: 0.82, h: 0.05 },
    highlightSource: "user",
    suggestedHighlight: { x: 0.09, y: 0.47, w: 0.6, h: 0.04 },
  },
  {
    id: "step-4",
    action: "Click 'Submit for approval'",
    description: "Scroll to the bottom of the form and click 'Submit for approval'.",
    expectedResult:
      "A confirmation banner shows 'PO-2024-00187 submitted for approval' and the status changes to 'Pending approval'.",
    timestampSec: 63,
    captureState: "ok",
    highlight: null,
    highlightSource: null,
    suggestedHighlight: null,
  },
];

export const fixtureProject: Project = {
  id: "fixture-project",
  title: "Create a purchase order",
  video: {
    name: "create-purchase-order.mp4",
    sizeBytes: 3_145_728,
    mimeType: "video/mp4",
    durationSec: 78,
    width: 1600,
    height: 1000,
  },
  gemini: { fileName: "files/fixture-po-0001", mimeType: "video/mp4", uploadedAt: "2026-11-20T09:30:00.000Z" },
  steps,
  updatedAt: "2026-11-20T09:32:10.000Z",
};

export const fixtureSteps = steps;

/**
 * Screenshot URL per step id. `new URL(…, import.meta.url)` is bundled as an asset by
 * Next (Turbopack) and resolves to a file:// URL in Vitest (read it with `fs`).
 */
export const fixtureShotUrls: Record<string, string> = {
  "step-1": new URL("./shots/step-1.webp", import.meta.url).href,
  "step-2": new URL("./shots/step-2.webp", import.meta.url).href,
  "step-3": new URL("./shots/step-3.webp", import.meta.url).href,
  "step-4": new URL("./shots/step-4.webp", import.meta.url).href,
};
