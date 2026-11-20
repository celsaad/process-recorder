// Lane E. Steps reducer (D7, D12).
import type { StepsAction, StepsState } from "./types";

export const initialSteps: StepsState = { steps: [], lastDeleted: null };

export function stepsReducer(state: StepsState, action: StepsAction): StepsState {
  void state;
  void action;
  throw new Error("not implemented");
}
