import { describe, expect, it } from "vitest";
import { box2dToRect, clampRect, MIN_RECT, moveRect, resizeRect } from "./geometry";
import type { Rect } from "./types";

const close = (r: Rect | null, expected: Rect) => {
  expect(r).not.toBeNull();
  for (const k of ["x", "y", "w", "h"] as const) expect(r![k]).toBeCloseTo(expected[k], 10);
};

const inBounds = (r: Rect) => {
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
  expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
  expect(r.w).toBeGreaterThanOrEqual(MIN_RECT);
  expect(r.h).toBeGreaterThanOrEqual(MIN_RECT);
};

describe("box2dToRect", () => {
  it("converts a valid box", () => {
    close(box2dToRect([100, 200, 300, 600]), { x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
  });

  it("reads the axis order as [ymin, xmin, ymax, xmax]", () => {
    const r = box2dToRect([0, 500, 250, 1000]);
    close(r, { x: 0.5, y: 0, w: 0.5, h: 0.25 });
  });

  it("accepts the full frame", () => {
    close(box2dToRect([0, 0, 1000, 1000]), { x: 0, y: 0, w: 1, h: 1 });
  });

  it.each([
    [[-1, 0, 100, 100]],
    [[0, 0, 1001, 100]],
    [[0, 0, 100, Number.NaN]],
  ])("rejects out-of-range %j", (box) => {
    expect(box2dToRect(box)).toBeNull();
  });

  it.each([[[]], [[1, 2, 3]], [[1, 2, 3, 4, 5]]])("rejects length ≠ 4: %j", (box) => {
    expect(box2dToRect(box)).toBeNull();
  });

  it("rejects zero area", () => {
    expect(box2dToRect([100, 100, 100, 500])).toBeNull();
    expect(box2dToRect([100, 100, 500, 100])).toBeNull();
  });

  it("rejects inverted boxes", () => {
    expect(box2dToRect([500, 100, 100, 600])).toBeNull();
    expect(box2dToRect([100, 600, 500, 100])).toBeNull();
  });
});

describe("clampRect", () => {
  const size = { w: 0.2, h: 0.1 };
  it("leaves an in-bounds rect alone", () => {
    expect(clampRect({ x: 0.3, y: 0.3, ...size })).toEqual({ x: 0.3, y: 0.3, ...size });
  });
  it("clamps at the left and top edges", () => {
    expect(clampRect({ x: -0.1, y: -0.5, ...size })).toEqual({ x: 0, y: 0, ...size });
  });
  it("clamps at the right and bottom edges without shrinking", () => {
    close(clampRect({ x: 0.95, y: 0.99, ...size }), { x: 0.8, y: 0.9, ...size });
  });
  it("caps the size at 1 and floors it at MIN_RECT", () => {
    expect(clampRect({ x: 0.5, y: 0.5, w: 2, h: 1.5 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const tiny = clampRect({ x: 0.5, y: 0.5, w: 0, h: -1 });
    expect(tiny.w).toBe(MIN_RECT);
    expect(tiny.h).toBe(MIN_RECT);
  });
});

describe("moveRect", () => {
  const r = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
  it("moves by the delta", () => {
    close(moveRect(r, 0.01, -0.1), { x: 0.41, y: 0.3, w: 0.2, h: 0.2 });
  });
  it.each([
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ])("stays in bounds when pushed by (%d, %d) and keeps its size", (dx, dy) => {
    const moved = moveRect(r, dx, dy);
    inBounds(moved);
    expect(moved.w).toBe(0.2);
    expect(moved.h).toBe(0.2);
  });
});

describe("resizeRect", () => {
  const r = { x: 0.7, y: 0.7, w: 0.2, h: 0.2 };
  it("resizes by the delta", () => {
    close(resizeRect(r, 0.05, -0.05), { x: 0.7, y: 0.7, w: 0.25, h: 0.15 });
  });
  it("never grows past the right/bottom edge", () => {
    const big = resizeRect(r, 1, 1);
    inBounds(big);
    close(big, { x: 0.7, y: 0.7, w: 0.3, h: 0.3 });
  });
  it("never shrinks below MIN_RECT", () => {
    const small = resizeRect(r, -1, -1);
    expect(small.w).toBe(MIN_RECT);
    expect(small.h).toBe(MIN_RECT);
    inBounds(small);
  });
});
