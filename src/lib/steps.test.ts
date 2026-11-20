import { describe, expect, it } from "vitest";
import { createStep, stepsFromRaw } from "./steps";
import type { RawStep } from "./types";

const raw = (over: Partial<RawStep> = {}): RawStep => ({
  action: "Click Save",
  description: "Click the Save button.",
  expectedResult: "The record is saved.",
  timestampSec: 10,
  box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
  ...over,
});

describe("createStep", () => {
  it("gives unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createStep({}, 0).id));
    expect(ids.size).toBe(50);
  });

  it("fills defaults and keeps the timestamp", () => {
    const s = createStep({ action: "Type a name" }, 12.5);
    expect(s).toMatchObject({
      action: "Type a name",
      description: "",
      expectedResult: "",
      timestampSec: 12.5,
      captureState: "pending",
      highlight: null,
      highlightSource: null,
      suggestedHighlight: null,
    });
  });
});

describe("stepsFromRaw", () => {
  it("clamps timestamps to [0, duration]", () => {
    const steps = stepsFromRaw([raw({ timestampSec: -2 }), raw({ timestampSec: 30 }), raw({ timestampSec: 95 })], 60);
    expect(steps.map((s) => s.timestampSec)).toEqual([0, 30, 60]);
  });

  it("sets pending and copies box to highlight and suggestedHighlight with source gemini", () => {
    const [s] = stepsFromRaw([raw()], 60);
    expect(s.captureState).toBe("pending");
    expect(s.highlight).toEqual(raw().box);
    expect(s.suggestedHighlight).toEqual(raw().box);
    expect(s.highlightSource).toBe("gemini");
    expect(s.highlight).not.toBe(s.suggestedHighlight); // independent copies
  });

  it("uses a null source when there is no box", () => {
    const [s] = stepsFromRaw([raw({ box: null })], 60);
    expect(s).toMatchObject({ highlight: null, suggestedHighlight: null, highlightSource: null });
  });

  it("copies the text and gives each step an id", () => {
    const steps = stepsFromRaw([raw(), raw({ action: "Click Submit" })], 60);
    expect(steps.map((s) => s.action)).toEqual(["Click Save", "Click Submit"]);
    expect(new Set(steps.map((s) => s.id)).size).toBe(2);
  });
});
