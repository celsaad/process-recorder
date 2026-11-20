// Lane E. Steps reducer (D7, D12). No-op actions return the same state object.
import type { Step, StepsAction, StepsState } from "./types";

export const initialSteps: StepsState = { steps: [], lastDeleted: null };

function patchStep(state: StepsState, id: string, fn: (s: Step) => Step): StepsState {
  const i = state.steps.findIndex((s) => s.id === id);
  if (i === -1) return state;
  const steps = state.steps.slice();
  steps[i] = fn(steps[i]);
  return { ...state, steps };
}

export function stepsReducer(state: StepsState, action: StepsAction): StepsState {
  switch (action.type) {
    case "load":
      return { steps: action.steps, lastDeleted: null };

    case "update":
      return patchStep(state, action.id, (s) => ({ ...s, ...action.patch }));

    case "add": {
      const steps = state.steps.slice();
      if (action.afterId === null) {
        steps.unshift(action.step);
      } else {
        const i = steps.findIndex((s) => s.id === action.afterId);
        // Unknown id: append rather than drop the user's new step.
        steps.splice(i === -1 ? steps.length : i + 1, 0, action.step);
      }
      return { ...state, steps };
    }

    case "remove": {
      const index = state.steps.findIndex((s) => s.id === action.id);
      if (index === -1) return state;
      return {
        steps: state.steps.filter((s) => s.id !== action.id),
        // Replaces any earlier deletion: only the latest one can be undone (D12).
        lastDeleted: { step: state.steps[index], index },
      };
    }

    case "undoRemove": {
      if (!state.lastDeleted) return state;
      const { step, index } = state.lastDeleted;
      const steps = state.steps.slice();
      steps.splice(Math.min(index, steps.length), 0, step);
      return { steps, lastDeleted: null };
    }

    case "dismissUndo":
      return state.lastDeleted ? { ...state, lastDeleted: null } : state;

    case "move": {
      const i = state.steps.findIndex((s) => s.id === action.id);
      if (i === -1) return state;
      const j = action.direction === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= state.steps.length) return state;
      const steps = state.steps.slice();
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...state, steps };
    }

    case "setTimestamp":
      return patchStep(state, action.id, (s) => {
        if (s.timestampSec === action.timestampSec) return s;
        // D9: the suggestion refers to the old frame, so it no longer applies after a re-pick.
        // A Gemini highlight goes with it; a user-drawn one is kept.
        const keep = s.highlightSource === "user";
        return {
          ...s,
          timestampSec: action.timestampSec,
          suggestedHighlight: null,
          highlight: keep ? s.highlight : null,
          highlightSource: keep ? s.highlightSource : null,
        };
      });

    case "setCaptureState":
      return patchStep(state, action.id, (s) =>
        s.captureState === action.captureState ? s : { ...s, captureState: action.captureState },
      );

    case "setHighlight":
      return patchStep(state, action.id, (s) => ({
        ...s,
        highlight: action.highlight,
        highlightSource: action.highlight ? action.source : null,
      }));
  }
}
