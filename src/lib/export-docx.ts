// Lane C. Word export (D11).
import type { Project, Step } from "./types";

export type GetShot = (stepId: string) => Promise<Blob | null>;

/** Landscape, title, 5-column table. */
export async function buildDocx(project: Project, steps: Step[], getShot: GetShot): Promise<Blob> {
  void project;
  void steps;
  void getShot;
  throw new Error("not implemented");
}

export function downloadBlob(blob: Blob, filename: string): void {
  void blob;
  void filename;
  throw new Error("not implemented");
}

/** "Create a purchase order" → "create-a-purchase-order.docx"; empty → "test-script.docx". */
export function exportFilename(title: string): string {
  void title;
  throw new Error("not implemented");
}
