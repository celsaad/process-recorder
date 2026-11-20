// Lane C. Encoding for storage (WebP, JPEG fallback) and export (JPEG, highlight burned in).
import type { Rect } from "./types";

export type ExportImage = { bytes: Uint8Array; width: number; height: number };

/** WebP 0.9, ≤ 1920 px wide; checks `blob.type` and falls back to JPEG. */
export async function encodeFrame(canvas: HTMLCanvasElement): Promise<Blob> {
  void canvas;
  throw new Error("not implemented");
}

/** JPEG 0.92 with the highlight drawn in. */
export async function renderForExport(shot: Blob, highlight: Rect | null): Promise<ExportImage> {
  void shot;
  void highlight;
  throw new Error("not implemented");
}
