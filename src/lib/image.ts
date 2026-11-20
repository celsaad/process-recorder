// Lane C. Encoding for storage (WebP, JPEG fallback) and export (JPEG, highlight burned in).
import { AppError } from "./errors";
import type { Rect } from "./types";

export type ExportImage = { bytes: Uint8Array; width: number; height: number };

/** Stored screenshots are never wider than this (D3). */
export const MAX_FRAME_WIDTH = 1920;
/** Same colour as the `--highlight` token, drawn into the exported pixels. */
export const HIGHLIGHT_COLOR = "#C9186E";

/** Scales down to `maxWidth` keeping the aspect ratio; smaller images are returned unchanged. */
export function scaleToFit(width: number, height: number, maxWidth = MAX_FRAME_WIDTH): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) };
}

/** Normalized rect → whole pixels. Edges are rounded, so adjacent rects never overlap or leave gaps. */
export function rectToPixels(rect: Rect, width: number, height: number): Rect {
  const x0 = Math.round(rect.x * width);
  const y0 = Math.round(rect.y * height);
  const x1 = Math.round((rect.x + rect.w) * width);
  const y1 = Math.round((rect.y + rect.h) * height);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Stroke width for the burned-in highlight. WordExport shows 2 px on a 258 px wide screenshot,
 * so it scales with the image: ~0.8% of the width, never under 2 px.
 */
export function highlightStroke(imageWidth: number): number {
  return Math.max(2, Math.round(imageWidth * 0.008));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** WebP 0.9, ≤ 1920 px wide; checks `blob.type` and falls back to JPEG. */
export async function encodeFrame(canvas: HTMLCanvasElement): Promise<Blob> {
  let source = canvas;
  const target = scaleToFit(canvas.width, canvas.height);
  if (target.width !== canvas.width) {
    source = document.createElement("canvas");
    source.width = target.width;
    source.height = target.height;
    const ctx = source.getContext("2d");
    if (!ctx) throw new AppError("capture_failed");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
  }
  const webp = await toBlob(source, "image/webp", 0.9);
  // Browsers that can't encode WebP silently return PNG.
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob(source, "image/jpeg", 0.9);
  if (!jpeg) throw new AppError("capture_failed");
  return jpeg;
}

/** JPEG 0.92 with the highlight drawn in: a pink outline with a white halo outside it (WordExport board). */
export async function renderForExport(shot: Blob, highlight: Rect | null): Promise<ExportImage> {
  const bitmap = await createImageBitmap(shot);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AppError("capture_failed");
    // JPEG has no alpha; transparent pixels would turn black.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    if (highlight) burnInHighlight(ctx, rectToPixels(highlight, canvas.width, canvas.height), canvas.width, canvas.height);
    // 1 px frame at the 258 px display size, like the board's #9CA3AF screenshot border.
    const frame = Math.max(1, Math.round(canvas.width / 258));
    ctx.strokeStyle = "#9CA3AF";
    ctx.lineWidth = frame;
    ctx.strokeRect(frame / 2, frame / 2, canvas.width - frame, canvas.height - frame);
    const blob = await toBlob(canvas, "image/jpeg", 0.92);
    if (!blob) throw new AppError("capture_failed");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

function outline(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  if (typeof ctx.roundRect === "function") ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

function burnInHighlight(ctx: CanvasRenderingContext2D, r: Rect, width: number, height: number) {
  const s = highlightStroke(width);
  // The border sits inside the box (like CSS `border`), the halo outside it.
  const edge = { x: r.x + s / 2, y: r.y + s / 2, w: Math.max(1, r.w - s), h: Math.max(1, r.h - s) };
  const radius = s * 2;

  // Halo: a white band `s` wide just outside the box, clipped so nothing is painted inside it.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  outline(ctx, r, radius);
  ctx.clip("evenodd");
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = s * 2;
  ctx.beginPath();
  outline(ctx, r, radius);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = HIGHLIGHT_COLOR;
  ctx.lineWidth = s;
  ctx.beginPath();
  outline(ctx, edge, Math.max(0, radius - s / 2));
  ctx.stroke();
  ctx.restore();
}
