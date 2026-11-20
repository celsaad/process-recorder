import { box2dToRect } from "./geometry";
import type { GeminiResponse } from "./schema";
import { parseTimestamp } from "./timestamp";
import type { RawStep } from "./types";

/** How far a step is pushed when it shares a timestamp with the previous one (D5). */
export const DUPLICATE_NUDGE_SEC = 0.5;

/** Lane A. parseTimestamp → drop unparseable, sort, nudge duplicates by +0.5 s, box2dToRect. */
export function normalizeSteps(parsed: GeminiResponse): RawStep[] {
  const steps = parsed.steps.flatMap((s, order) => {
    const timestampSec = parseTimestamp(s.timestamp);
    if (timestampSec === null) return [];
    const step: RawStep = {
      action: s.action.trim(),
      description: s.description.trim(),
      expectedResult: s.expectedResult.trim(),
      timestampSec,
      box: box2dToRect(s.box_2d),
    };
    return [{ step, order }];
  });

  // Stable sort: steps the model gave the same time keep the model's order.
  steps.sort((a, b) => a.step.timestampSec - b.step.timestampSec || a.order - b.order);

  let prev = -Infinity;
  return steps.map(({ step }) => {
    const timestampSec =
      step.timestampSec <= prev ? prev + DUPLICATE_NUDGE_SEC : step.timestampSec;
    prev = timestampSec;
    return timestampSec === step.timestampSec ? step : { ...step, timestampSec };
  });
}
