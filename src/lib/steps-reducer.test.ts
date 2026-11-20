import { describe, expect, it } from "vitest";
import { fixtureSteps } from "@/fixtures/project";
import { createStep } from "./steps";
import { initialSteps, stepsReducer } from "./steps-reducer";
import type { StepsState } from "./types";

const loaded = (): StepsState => stepsReducer(initialSteps, { type: "load", steps: fixtureSteps });
const ids = (s: StepsState) => s.steps.map((x) => x.id);

describe("stepsReducer", () => {
  it("load replaces steps and clears lastDeleted", () => {
    const withDeleted = stepsReducer(loaded(), { type: "remove", id: "step-1" });
    const next = stepsReducer(withDeleted, { type: "load", steps: fixtureSteps.slice(0, 2) });
    expect(ids(next)).toEqual(["step-1", "step-2"]);
    expect(next.lastDeleted).toBeNull();
  });

  it("update patches only the given step", () => {
    const s = loaded();
    const next = stepsReducer(s, { type: "update", id: "step-2", patch: { action: "New action" } });
    expect(next.steps[1].action).toBe("New action");
    expect(next.steps[1].description).toBe(s.steps[1].description);
    expect(next.steps[0]).toBe(s.steps[0]);
  });

  it("update of an unknown id returns the same state", () => {
    const s = loaded();
    expect(stepsReducer(s, { type: "update", id: "nope", patch: { action: "x" } })).toBe(s);
  });

  it("add inserts after a given id", () => {
    const step = createStep({ action: "Inserted" }, 20);
    const next = stepsReducer(loaded(), { type: "add", afterId: "step-2", step });
    expect(ids(next)).toEqual(["step-1", "step-2", step.id, "step-3", "step-4"]);
  });

  it("add with afterId null inserts at the start", () => {
    const step = createStep({}, 0);
    const next = stepsReducer(loaded(), { type: "add", afterId: null, step });
    expect(ids(next)[0]).toBe(step.id);
    expect(next.steps).toHaveLength(5);
  });

  it("remove then undoRemove restores the step at its original index", () => {
    const s = loaded();
    const removed = stepsReducer(s, { type: "remove", id: "step-3" });
    expect(ids(removed)).toEqual(["step-1", "step-2", "step-4"]);
    expect(removed.lastDeleted).toEqual({ step: s.steps[2], index: 2 });
    const undone = stepsReducer(removed, { type: "undoRemove" });
    expect(ids(undone)).toEqual(ids(s));
    expect(undone.steps[2]).toBe(s.steps[2]);
    expect(undone.lastDeleted).toBeNull();
  });

  it("a second remove replaces lastDeleted", () => {
    let s = stepsReducer(loaded(), { type: "remove", id: "step-1" });
    s = stepsReducer(s, { type: "remove", id: "step-4" });
    expect(s.lastDeleted?.step.id).toBe("step-4");
    expect(s.lastDeleted?.index).toBe(2);
  });

  it("undoRemove clamps the index if the list got shorter", () => {
    let s = stepsReducer(loaded(), { type: "remove", id: "step-4" });
    s = { ...s, steps: s.steps.slice(0, 1) };
    s = stepsReducer(s, { type: "undoRemove" });
    expect(ids(s)).toEqual(["step-1", "step-4"]);
  });

  it("undoRemove and dismissUndo without a deletion return the same state", () => {
    const s = loaded();
    expect(stepsReducer(s, { type: "undoRemove" })).toBe(s);
    expect(stepsReducer(s, { type: "dismissUndo" })).toBe(s);
  });

  it("dismissUndo clears lastDeleted and keeps the steps", () => {
    const removed = stepsReducer(loaded(), { type: "remove", id: "step-2" });
    const next = stepsReducer(removed, { type: "dismissUndo" });
    expect(next.lastDeleted).toBeNull();
    expect(next.steps).toBe(removed.steps);
  });

  it("move swaps with the neighbour", () => {
    const up = stepsReducer(loaded(), { type: "move", id: "step-3", direction: "up" });
    expect(ids(up)).toEqual(["step-1", "step-3", "step-2", "step-4"]);
    const down = stepsReducer(loaded(), { type: "move", id: "step-1", direction: "down" });
    expect(ids(down)).toEqual(["step-2", "step-1", "step-3", "step-4"]);
  });

  it("move at the ends does nothing", () => {
    const s = loaded();
    expect(stepsReducer(s, { type: "move", id: "step-1", direction: "up" })).toBe(s);
    expect(stepsReducer(s, { type: "move", id: "step-4", direction: "down" })).toBe(s);
  });

  it("setTimestamp clears a gemini highlight and its suggestion", () => {
    const next = stepsReducer(loaded(), { type: "setTimestamp", id: "step-1", timestampSec: 6 });
    expect(next.steps[0]).toMatchObject({
      timestampSec: 6,
      highlight: null,
      highlightSource: null,
      suggestedHighlight: null,
    });
  });

  it("setTimestamp keeps a user highlight", () => {
    const s = loaded();
    const next = stepsReducer(s, { type: "setTimestamp", id: "step-3", timestampSec: 45 });
    expect(next.steps[2].highlight).toEqual(s.steps[2].highlight);
    expect(next.steps[2].highlightSource).toBe("user");
    expect(next.steps[2].timestampSec).toBe(45);
  });

  it("setTimestamp to the same time changes nothing", () => {
    const s = loaded();
    const next = stepsReducer(s, { type: "setTimestamp", id: "step-1", timestampSec: 4 });
    expect(next.steps[0]).toBe(s.steps[0]);
  });

  it("setCaptureState sets the state", () => {
    const next = stepsReducer(loaded(), { type: "setCaptureState", id: "step-2", captureState: "failed" });
    expect(next.steps[1].captureState).toBe("failed");
  });

  it("setHighlight sets the rect and source; null clears the source", () => {
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    let s = stepsReducer(loaded(), { type: "setHighlight", id: "step-4", highlight: rect, source: "user" });
    expect(s.steps[3]).toMatchObject({ highlight: rect, highlightSource: "user" });
    s = stepsReducer(s, { type: "setHighlight", id: "step-4", highlight: null, source: "user" });
    expect(s.steps[3]).toMatchObject({ highlight: null, highlightSource: null });
  });
});
