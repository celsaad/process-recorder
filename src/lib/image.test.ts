import { describe, expect, it } from "vitest";
import { highlightStroke, rectToPixels, scaleToFit } from "./image";

describe("scaleToFit", () => {
  it("scales a Retina frame down to 1920 wide", () => {
    expect(scaleToFit(3456, 1990)).toEqual({ width: 1920, height: 1106 });
  });
  it("leaves smaller frames unchanged", () => {
    expect(scaleToFit(1296, 720)).toEqual({ width: 1296, height: 720 });
    expect(scaleToFit(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });
  it("never returns a zero height", () => {
    expect(scaleToFit(100000, 1).height).toBe(1);
  });
});

describe("rectToPixels", () => {
  it("converts a normalized rect to whole pixels", () => {
    expect(rectToPixels({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 1600, 1000)).toEqual({ x: 160, y: 200, w: 800, h: 250 });
  });
  it("rounds edges rather than sizes", () => {
    expect(rectToPixels({ x: 0.333, y: 0.5, w: 0.333, h: 0.1 }, 100, 100)).toEqual({ x: 33, y: 50, w: 34, h: 10 });
  });
  it("keeps at least one pixel", () => {
    expect(rectToPixels({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, 100, 100)).toMatchObject({ w: 1, h: 1 });
  });
});

describe("highlightStroke", () => {
  it("scales with the image and has a floor", () => {
    expect(highlightStroke(200)).toBe(2);
    expect(highlightStroke(1600)).toBe(13);
  });
});
