import type { GeminiResponse } from "./schema";
import type { RawStep } from "./types";

/** Lane A. parseTimestamp → drop unparseable, sort, nudge duplicates by +0.5 s, box2dToRect. */
export function normalizeSteps(parsed: GeminiResponse): RawStep[] {
  void parsed;
  throw new Error("not implemented");
}
