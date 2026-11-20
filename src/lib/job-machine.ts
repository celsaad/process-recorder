// Lane F. Job state machine (D7). Invalid transitions return the same state object.
import type { JobAction, JobState } from "./types";

export const initialJob: JobState = { phase: "idle" };

export function jobReducer(state: JobState, action: JobAction): JobState {
  void state;
  void action;
  throw new Error("not implemented");
}
