import type { RawStep, Step } from "./types";

type StepInit = Partial<Omit<Step, "id" | "timestampSec">>;

/** A new step with a fresh id. Defaults: empty text, `pending` capture, no highlight. */
export function createStep(partial: StepInit, timestampSec: number): Step {
  return {
    action: "",
    description: "",
    expectedResult: "",
    captureState: "pending",
    highlight: null,
    highlightSource: null,
    suggestedHighlight: null,
    ...partial,
    id: crypto.randomUUID(),
    timestampSec,
  };
}

/** Server steps → editor steps: timestamps clamped to [0, durationSec], Gemini's box as the highlight. */
export function stepsFromRaw(raw: RawStep[], durationSec: number): Step[] {
  const max = Math.max(0, durationSec);
  return raw.map((r) =>
    createStep(
      {
        action: r.action,
        description: r.description,
        expectedResult: r.expectedResult,
        captureState: "pending",
        highlight: r.box,
        suggestedHighlight: r.box ? { ...r.box } : null,
        highlightSource: r.box ? "gemini" : null,
      },
      Math.min(max, Math.max(0, r.timestampSec)),
    ),
  );
}
