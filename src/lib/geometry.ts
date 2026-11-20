import type { Rect } from "./types";

/** Smallest highlight width/height, normalized (2% of the image). */
export const MIN_RECT = 0.02;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Gemini's `box_2d` is `[ymin, xmin, ymax, xmax]` in 0–1000.
 * Returns null unless it has exactly 4 finite values in range with positive area.
 */
export function box2dToRect(box: number[]): Rect | null {
  if (box.length !== 4) return null;
  if (!box.every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) return null;
  const [ymin, xmin, ymax, xmax] = box;
  if (ymax <= ymin || xmax <= xmin) return null;
  return { x: xmin / 1000, y: ymin / 1000, w: (xmax - xmin) / 1000, h: (ymax - ymin) / 1000 };
}

/** Keeps the size within [MIN_RECT, 1] and the rect inside the unit square (shifting, not shrinking). */
export function clampRect(r: Rect): Rect {
  const w = clamp(r.w, MIN_RECT, 1);
  const h = clamp(r.h, MIN_RECT, 1);
  return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h };
}

/** Moves without changing size; stops at the edges. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy });
}

/** Resizes from the top-left corner; never below MIN_RECT or past the right/bottom edge. */
export function resizeRect(r: Rect, dw: number, dh: number): Rect {
  const base = clampRect(r);
  return {
    ...base,
    w: clamp(base.w + dw, MIN_RECT, 1 - base.x),
    h: clamp(base.h + dh, MIN_RECT, 1 - base.y),
  };
}
