// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { LiveRegionProvider } from "@/components/shell/LiveRegion";
import { fixtureSteps } from "@/fixtures/project";
import { stepsReducer } from "@/lib/steps-reducer";
import type { Step } from "@/lib/types";
import { stepHeadingDomId } from "@/lib/ui-contracts";
import { DeletedStepRow } from "./DeletedStepRow";
import { StepList } from "./StepList";

const SHOT = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const shotUrls = Object.fromEntries(fixtureSteps.map((s) => [s.id, SHOT]));

function Harness({
  onAddStep = vi.fn(),
  steps = fixtureSteps,
}: {
  onAddStep?: (afterId: string | null) => void;
  steps?: Step[];
}) {
  const [state, dispatch] = useReducer(stepsReducer, { steps, lastDeleted: null });
  return (
    <StepList
      steps={state.steps}
      lastDeleted={state.lastDeleted}
      shotUrls={shotUrls}
      dispatch={dispatch}
      onPickFrame={vi.fn()}
      onAddStep={onAddStep}
    />
  );
}

function setup(onAddStep?: (afterId: string | null) => void, steps?: Step[]) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const utils = render(
    <LiveRegionProvider>
      <Harness onAddStep={onAddStep} steps={steps} />
    </LiveRegionProvider>,
  );
  return { user, ...utils };
}

const headings = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
const actionOf = (n: number) =>
  within(screen.getByRole("article", { name: `Step ${n}` })).getByLabelText<HTMLTextAreaElement>("Action").value;
const flushAnnouncement = () => act(() => void vi.advanceTimersByTime(100));

describe("StepList", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders an ordered list of step articles", async () => {
    const { container } = setup();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(headings()).toEqual(["Step 1", "Step 2", "Step 3", "Step 4"]);
    expect(screen.getByRole("button", { name: "Add step after step 1" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("after a move, focus stays on the moved step's button and the move is announced", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Move step 2 up" }));
    expect(actionOf(1)).toBe(fixtureSteps[1].action);
    const up = screen.getByRole("button", { name: "Move step 1 up" });
    expect(up).toHaveFocus();
    expect(up).toHaveAttribute("aria-disabled", "true");
    flushAnnouncement();
    expect(screen.getByTestId("live-region")).toHaveTextContent("Step moved to position 1");

    await user.keyboard("{Enter}"); // at the top: no-op, focus kept
    expect(up).toHaveFocus();
    expect(actionOf(1)).toBe(fixtureSteps[1].action);
  });

  it("delete: inline row at the deleted index, focus on Undo, announced", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: "Delete step 3" }));
    const items = screen.getAllByRole("listitem");
    expect(items[2]).toHaveTextContent("Step 3 deleted");
    expect(items[2]).toHaveTextContent(fixtureSteps[2].action);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    flushAnnouncement();
    expect(screen.getByTestId("live-region")).toHaveTextContent("Step 3 deleted");

    // Tab: Undo → Dismiss → the next step.
    await user.tab();
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("article", { name: "Step 3" })).toContainElement(document.activeElement as HTMLElement);

    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the row never times out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(within(screen.getByRole("list")).getByText("Step 2 deleted")).toBeInTheDocument();
  });

  it("Undo restores the step in place and focuses its heading", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    await user.keyboard("{Enter}"); // focus is on Undo
    expect(headings()).toHaveLength(4);
    expect(actionOf(2)).toBe(fixtureSteps[1].action);
    expect(screen.getByRole("heading", { name: "Step 2" })).toHaveFocus();
    expect(within(screen.getByRole("list")).queryByText("Step 2 deleted")).not.toBeInTheDocument();
  });

  it("Dismiss focuses the next step, or the previous one if the last was deleted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(within(screen.getByRole("list")).queryByText("Step 2 deleted")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Step 2" })).toHaveFocus();
    expect(actionOf(2)).toBe(fixtureSteps[2].action);

    await user.click(screen.getByRole("button", { name: "Delete step 3" })); // the last one
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("heading", { name: "Step 2" })).toHaveFocus();
  });

  it("heading ids follow the stepHeadingDomId(n) contract, also after a move", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    const ids = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.id);
    expect(ids()).toEqual([1, 2, 3, 4].map(stepHeadingDomId));
    expect(document.getElementById(stepHeadingDomId(3))).toHaveTextContent("Step 3");
    await user.click(screen.getByRole("button", { name: "Move step 3 up" }));
    expect(ids()).toEqual([1, 2, 3, 4].map(stepHeadingDomId));
    const article = screen.getByRole("article", { name: "Step 2" });
    expect(article).toHaveAttribute("aria-labelledby", stepHeadingDomId(2));
    expect(within(article).getByLabelText<HTMLTextAreaElement>("Action").value).toBe(fixtureSteps[2].action);
  });

  it("Undo focuses the restored step's heading through its numbered id", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Delete step 1" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(document.activeElement).toBe(document.getElementById(stepHeadingDomId(1)));
  });

  it("Dismiss with no steps left focuses Add step at the end", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup(undefined, fixtureSteps.slice(0, 1));
    await user.click(screen.getByRole("button", { name: "Delete step 1" }));
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add step at the end" })).toHaveFocus();
  });

  it("Dismiss with one step left focuses that step", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup(undefined, fixtureSteps.slice(0, 2));
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("heading", { name: "Step 1" })).toHaveFocus();
  });

  it("a second delete replaces the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Delete step 1" }));
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    const list = within(screen.getByRole("list"));
    expect(list.queryByText("Step 1 deleted")).not.toBeInTheDocument();
    expect(list.getByText("Step 2 deleted")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("Add step buttons pass the id to add after", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onAddStep = vi.fn();
    const { user } = setup(onAddStep);
    await user.click(screen.getByRole("button", { name: "Add step after step 2" }));
    expect(onAddStep).toHaveBeenLastCalledWith("step-2");
    await user.click(screen.getByRole("button", { name: "Add step at the end" }));
    expect(onAddStep).toHaveBeenLastCalledWith("step-4");
  });
});

describe("DeletedStepRow", () => {
  afterEach(cleanup);

  it("shows the step number and action with Undo and Dismiss", async () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <DeletedStepRow deleted={{ step: fixtureSteps[2], index: 2 }} onUndo={onUndo} onDismiss={onDismiss} />,
    );
    expect(screen.getByText("Step 3 deleted")).toBeInTheDocument();
    expect(screen.getByText(fixtureSteps[2].action)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role=status]")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
