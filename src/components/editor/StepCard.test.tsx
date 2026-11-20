// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { fixtureSteps } from "@/fixtures/project";
import type { Step } from "@/lib/types";
import type { StepCardProps } from "@/lib/ui-contracts";
import { StepCard } from "./StepCard";

const SHOT = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

function renderCard(over: Partial<StepCardProps> & { step?: Step } = {}) {
  const props: StepCardProps = {
    step: fixtureSteps[2],
    index: 2,
    total: 4,
    shotUrl: SHOT,
    onChange: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onPickFrame: vi.fn(),
    onHighlightChange: vi.fn(),
    ...over,
  };
  return { props, ...render(<StepCard {...props} />) };
}

/** Accessible name starts with the visible text (WCAG 2.5.3). */
function expectLabelInName(button: HTMLElement) {
  const visible = Array.from(button.childNodes)
    .map((n) => (n instanceof HTMLElement ? (n.querySelector(".sr-only") ? n.firstChild?.textContent : n.textContent) : n.textContent))
    .join("")
    .trim();
  const name = button.getAttribute("aria-label") ?? button.textContent ?? "";
  if (visible) expect(name.toLowerCase().startsWith(visible.toLowerCase())).toBe(true);
}

describe("StepCard", () => {
  afterEach(cleanup);

  it("labels every field and names every button with the step number", async () => {
    const { container } = renderCard();
    expect(screen.getByRole("heading", { name: "Step 3" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Step 3" })).toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toHaveValue(fixtureSteps[2].action);
    expect(screen.getByLabelText("Description")).toHaveValue(fixtureSteps[2].description);
    expect(screen.getByLabelText("Expected result")).toHaveValue(fixtureSteps[2].expectedResult);
    for (const name of [
      "0:41, pick frame for step 3",
      "Pick frame for step 3",
      "Remove highlight for step 3",
      "Reset to suggestion for step 3",
      "Move step 3 up",
      "Move step 3 down",
      "Delete step 3",
      "Highlight on step 3 screenshot",
    ]) {
      const button = screen.getByRole("button", { name });
      expectLabelInName(button);
    }
    expect(screen.getByRole("img", { name: "Screenshot for step 3" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("forwards field edits as patches", async () => {
    const user = userEvent.setup();
    const { props } = renderCard({ step: { ...fixtureSteps[3], action: "" } });
    await user.type(screen.getByLabelText("Action"), "X");
    expect(props.onChange).toHaveBeenCalledWith({ action: "X" });
  });

  it("first step: Move up is aria-disabled, focusable, and does nothing", async () => {
    const user = userEvent.setup();
    const { props } = renderCard({ step: fixtureSteps[0], index: 0 });
    const up = screen.getByRole("button", { name: "Move step 1 up" });
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(up).not.toBeDisabled();
    up.focus();
    await user.keyboard("{Enter}");
    expect(props.onMove).not.toHaveBeenCalled();
    expect(up).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Move step 1 down" }));
    expect(props.onMove).toHaveBeenCalledWith("down");
  });

  it("last step: Move down is aria-disabled", async () => {
    const user = userEvent.setup();
    const { props } = renderCard({ step: fixtureSteps[3], index: 3 });
    const down = screen.getByRole("button", { name: "Move step 4 down" });
    expect(down).toHaveAttribute("aria-disabled", "true");
    await user.click(down);
    expect(props.onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Move step 4 up" })).not.toHaveAttribute("aria-disabled");
  });

  it("shows Reset only when there's a suggestion that differs from the highlight", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();
    await user.click(screen.getByRole("button", { name: "Reset to suggestion for step 3" }));
    expect(props.onHighlightChange).toHaveBeenCalledWith(fixtureSteps[2].suggestedHighlight, "gemini");
    cleanup();
    renderCard({ step: fixtureSteps[3], index: 3 }); // no suggestion
    expect(screen.queryByRole("button", { name: /Reset to suggestion/ })).not.toBeInTheDocument();
    cleanup();
    renderCard({ step: fixtureSteps[0], index: 0 }); // highlight is the suggestion
    expect(screen.queryByRole("button", { name: /Reset to suggestion/ })).not.toBeInTheDocument();
  });

  it("Add highlight without one, Remove with one", async () => {
    const user = userEvent.setup();
    const { props } = renderCard({ step: fixtureSteps[3], index: 3 });
    await user.click(screen.getByRole("button", { name: "Add highlight for step 4" }));
    expect(props.onHighlightChange).toHaveBeenCalledWith(expect.objectContaining({ w: 0.3 }), "user");
    cleanup();
    const r = renderCard();
    await user.click(screen.getByRole("button", { name: "Remove highlight for step 3" }));
    expect(r.props.onHighlightChange).toHaveBeenCalledWith(null, null);
  });

  it("pending: skeleton, no image, Pick frame aria-disabled", async () => {
    const { container, props } = renderCard({ step: { ...fixtureSteps[2], captureState: "pending" }, shotUrl: undefined });
    expect(screen.getByTestId("shot-skeleton")).toHaveTextContent("Capturing screenshot at 0:41");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const pick = screen.getByRole("button", { name: "Pick frame for step 3" });
    expect(pick).toHaveAttribute("aria-disabled", "true");
    await userEvent.setup().click(pick);
    expect(props.onPickFrame).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("failed: placeholder with Pick frame for step N", async () => {
    const user = userEvent.setup();
    const { container, props } = renderCard({ step: { ...fixtureSteps[2], captureState: "failed" }, shotUrl: undefined });
    expect(screen.getByText("No screenshot for this step")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Pick frame for step 3" });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(props.onPickFrame).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /highlight/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the timestamp button opens the picker", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();
    await user.click(screen.getByRole("button", { name: "0:41, pick frame for step 3" }));
    expect(props.onPickFrame).toHaveBeenCalledTimes(1);
  });

  it("follows the UX tab order", async () => {
    const user = userEvent.setup();
    renderCard();
    const article = screen.getByRole("article");
    const order = [
      "0:41, pick frame for step 3",
      "Action",
      "Description",
      "Expected result",
      "Highlight on step 3 screenshot",
      "Pick frame for step 3",
      "Remove highlight for step 3",
      "Reset to suggestion for step 3",
      "Move step 3 up",
      "Move step 3 down",
      "Delete step 3",
    ];
    const seen: string[] = [];
    for (let i = 0; i < order.length; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      expect(article).toContainElement(el);
      seen.push(
        el.tagName === "TEXTAREA"
          ? (within(article).getByText((_, n) => n?.getAttribute("for") === el.id).textContent ?? "")
          : (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
      );
    }
    expect(seen).toEqual(order);
  });
});
