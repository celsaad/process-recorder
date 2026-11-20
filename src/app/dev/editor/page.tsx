"use client";

// Dev page for Lane E: the fixture project in the real StepList + reducer, with fixture shots.
import { useReducer, useState } from "react";
import { StepList } from "@/components/editor/StepList";
import { Button } from "@/components/ui/button";
import { fixtureShotUrls, fixtureSteps } from "@/fixtures/project";
import { createStep } from "@/lib/steps";
import { stepsReducer } from "@/lib/steps-reducer";

const FALLBACK_SHOT = fixtureShotUrls["step-1"];

export default function DevEditorPage() {
  const [state, dispatch] = useReducer(stepsReducer, { steps: fixtureSteps, lastDeleted: null });
  const [shotUrls, setShotUrls] = useState<Record<string, string>>(fixtureShotUrls);

  // Mimics the hook's sequential capture: every step pending, then ok one by one.
  const simulateCapture = () => {
    const ids = state.steps.map((s) => s.id);
    ids.forEach((id) => dispatch({ type: "setCaptureState", id, captureState: "pending" }));
    ids.forEach((id, i) =>
      setTimeout(() => dispatch({ type: "setCaptureState", id, captureState: "ok" }), 800 * (i + 1)),
    );
  };

  const failOne = () => {
    const step = state.steps[Math.min(2, state.steps.length - 1)];
    if (step) dispatch({ type: "setCaptureState", id: step.id, captureState: "failed" });
  };

  // Stands in for the frame picker: re-picks 2 s later (clears a Gemini highlight, D9).
  const pickFrame = (id: string) => {
    const step = state.steps.find((s) => s.id === id);
    if (!step) return;
    dispatch({ type: "setTimestamp", id, timestampSec: step.timestampSec + 2 });
    dispatch({ type: "setCaptureState", id, captureState: "ok" });
    setShotUrls((u) => ({ ...u, [id]: u[id] ?? FALLBACK_SHOT }));
  };

  const addStep = (afterId: string | null) => {
    const prev = state.steps.find((s) => s.id === afterId);
    const step = createStep({ captureState: "ok" }, (prev?.timestampSec ?? 0) + 1);
    setShotUrls((u) => ({ ...u, [step.id]: (afterId && u[afterId]) || FALLBACK_SHOT }));
    dispatch({ type: "add", afterId, step });
  };

  return (
    <main className="mx-auto flex w-full max-w-[1224px] flex-col gap-6 px-[clamp(16px,4vw,32px)] pt-6 pb-12">
      <h1 className="m-0 text-xl font-semibold">Dev: step editor</h1>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={simulateCapture}>
          Simulate capture
        </Button>
        <Button type="button" variant="outline" onClick={failOne}>
          Fail a capture
        </Button>
        <Button type="button" variant="outline" onClick={() => dispatch({ type: "load", steps: fixtureSteps })}>
          Reset fixture
        </Button>
      </div>
      <StepList
        steps={state.steps}
        lastDeleted={state.lastDeleted}
        shotUrls={shotUrls}
        dispatch={dispatch}
        onPickFrame={pickFrame}
        onAddStep={addStep}
      />
    </main>
  );
}
