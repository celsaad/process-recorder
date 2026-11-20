// Lane F. Job state machine (D7). Invalid transitions return the same state object.
import type { JobAction, JobState } from "./types";

export const initialJob: JobState = { phase: "idle" };

export function jobReducer(state: JobState, action: JobAction): JobState {
  switch (action.type) {
    case "start":
      if (state.phase === "running") return state;
      return { phase: "running", stage: "validating", stageStartedAt: action.at, completed: [] };

    case "stage": {
      if (state.phase !== "running" || state.stage === action.stage) return state;
      const completed = state.completed.includes(state.stage) ? state.completed : [...state.completed, state.stage];
      return { phase: "running", stage: action.stage, stageStartedAt: action.at, completed };
    }

    case "captureProgress":
      if (state.phase !== "running" || state.stage !== "capturing") return state;
      return { ...state, capture: { done: action.done, total: action.total } };

    case "succeed":
      return state.phase === "running" ? { phase: "ready" } : state;

    case "restore":
      return state.phase === "idle" ? { phase: "ready" } : state;

    case "fail":
      if (state.phase !== "running") return state;
      return { phase: "error", error: action.error, retryFrom: action.retryFrom };

    case "cancel":
      return state.phase === "running" ? initialJob : state;

    case "reset":
      return state.phase === "idle" ? state : initialJob;
  }
}
