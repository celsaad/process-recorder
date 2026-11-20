import { describe, expect, it } from "vitest";
import { initialJob, jobReducer } from "./job-machine";
import type { JobAction, JobState } from "./types";

const running = (over: Partial<Extract<JobState, { phase: "running" }>> = {}): JobState => ({
  phase: "running",
  stage: "validating",
  stageStartedAt: 1,
  completed: [],
  ...over,
});
const ready: JobState = { phase: "ready" };
const error: JobState = { phase: "error", error: { kind: "network" }, retryFrom: "upload" };

const run = (state: JobState, ...actions: JobAction[]) => actions.reduce(jobReducer, state);

describe("jobReducer", () => {
  it("starts idle", () => {
    expect(initialJob).toEqual({ phase: "idle" });
  });

  it.each([
    ["idle", initialJob],
    ["error", error],
    ["ready", ready],
  ])("start: %s → running(validating)", (_, from) => {
    expect(jobReducer(from, { type: "start", at: 5 })).toEqual({
      phase: "running",
      stage: "validating",
      stageStartedAt: 5,
      completed: [],
    });
  });

  it("stage: moves on, records the start time and accumulates completed stages", () => {
    const s = run(
      initialJob,
      { type: "start", at: 1 },
      { type: "stage", stage: "received", at: 2 },
      { type: "stage", stage: "sending_to_gemini", at: 3 },
      { type: "stage", stage: "gemini_processing", at: 4 },
      { type: "stage", stage: "analyzing", at: 5 },
    );
    expect(s).toEqual({
      phase: "running",
      stage: "analyzing",
      stageStartedAt: 5,
      completed: ["validating", "received", "sending_to_gemini", "gemini_processing"],
    });
  });

  it("stage: the same stage again is a no-op", () => {
    const s = running({ stage: "received" });
    expect(jobReducer(s, { type: "stage", stage: "received", at: 9 })).toBe(s);
  });

  it("captureProgress: sets progress while capturing", () => {
    const s = running({ stage: "capturing" });
    expect(jobReducer(s, { type: "captureProgress", done: 2, total: 5 })).toEqual({
      ...s,
      capture: { done: 2, total: 5 },
    });
  });

  it("succeed: running → ready", () => {
    expect(jobReducer(running({ stage: "capturing" }), { type: "succeed" })).toEqual(ready);
  });

  it("restore: idle → ready", () => {
    expect(jobReducer(initialJob, { type: "restore" })).toEqual(ready);
  });

  it("fail: running → error, keeping retryFrom", () => {
    const s = jobReducer(running({ stage: "analyzing" }), {
      type: "fail",
      error: { kind: "rate_limited" },
      retryFrom: "analyze",
    });
    expect(s).toEqual({ phase: "error", error: { kind: "rate_limited" }, retryFrom: "analyze" });
  });

  it("cancel: running → idle", () => {
    expect(jobReducer(running(), { type: "cancel" })).toEqual(initialJob);
  });

  it.each([running(), ready, error])("reset: %o → idle", (from) => {
    expect(jobReducer(from, { type: "reset" })).toEqual(initialJob);
  });

  describe("invalid transitions return the same state object", () => {
    const cases: [string, JobState, JobAction][] = [
      ["start while running", running(), { type: "start", at: 2 }],
      ["stage while idle", initialJob, { type: "stage", stage: "received", at: 2 }],
      ["stage while ready", ready, { type: "stage", stage: "analyzing", at: 2 }],
      ["stage while error", error, { type: "stage", stage: "analyzing", at: 2 }],
      ["captureProgress while idle", initialJob, { type: "captureProgress", done: 1, total: 2 }],
      ["captureProgress before capturing", running({ stage: "analyzing" }), { type: "captureProgress", done: 1, total: 2 }],
      ["succeed while idle", initialJob, { type: "succeed" }],
      ["succeed while error", error, { type: "succeed" }],
      ["succeed while ready", ready, { type: "succeed" }],
      ["restore while running", running(), { type: "restore" }],
      ["restore while ready", ready, { type: "restore" }],
      ["restore while error", error, { type: "restore" }],
      ["fail while idle", initialJob, { type: "fail", error: { kind: "network" }, retryFrom: null }],
      ["fail while ready", ready, { type: "fail", error: { kind: "network" }, retryFrom: null }],
      ["fail while error", error, { type: "fail", error: { kind: "gemini_failed" }, retryFrom: null }],
      ["cancel while idle", initialJob, { type: "cancel" }],
      ["cancel while ready", ready, { type: "cancel" }],
      ["cancel while error", error, { type: "cancel" }],
      ["reset while idle", initialJob, { type: "reset" }],
    ];
    it.each(cases)("%s", (_, state, action) => {
      expect(jobReducer(state, action)).toBe(state);
    });
  });
});
