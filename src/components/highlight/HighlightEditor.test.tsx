// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { Rect } from "@/lib/types";
import { HighlightEditor, resizeFromCorner } from "./HighlightEditor";

const START: Rect = { x: 0.5, y: 0.5, w: 0.2, h: 0.1 };

function Harness({ onChange }: { onChange: (r: Rect | null) => void }) {
  const [rect, setRect] = useState<Rect | null>(START);
  return (
    <HighlightEditor
      imageUrl="data:image/gif;base64,R0lGODlhAQABAAAAACw="
      alt="Screenshot for step 3"
      stepNumber={3}
      highlight={rect}
      suggested={null}
      onChange={(r) => {
        setRect(r);
        onChange(r);
      }}
    />
  );
}

const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as Rect | null;

describe("HighlightEditor", () => {
  afterEach(cleanup);

  it("is named per step, describes its keys, and shows 4 handles when focused", async () => {
    const { container } = render(<Harness onChange={() => {}} />);
    const rect = screen.getByRole("button", { name: "Highlight on step 3 screenshot" });
    expect(rect).toHaveAccessibleDescription(/Arrow keys move.*Alt \+ arrows resize.*Delete removes/);
    rect.focus();
    expect(await screen.findAllByText("", { selector: "[data-handle]" })).toHaveLength(4);
    expect(screen.getByRole("img", { name: "Screenshot for step 3" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("arrows move by 1%, Shift by 10%", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("button", { name: /Highlight on step 3/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(last(onChange)!.x).toBeCloseTo(0.51);
    await user.keyboard("{ArrowDown}");
    expect(last(onChange)!.y).toBeCloseTo(0.51);
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(last(onChange)!.x).toBeCloseTo(0.41);
    expect(last(onChange)!.w).toBeCloseTo(0.2);
  });

  it("Alt + arrows resize", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("button", { name: /Highlight on step 3/ }).focus();
    await user.keyboard("{Alt>}{ArrowRight}{ArrowDown}{/Alt}");
    expect(last(onChange)).toMatchObject({ x: 0.5, y: 0.5 });
    expect(last(onChange)!.w).toBeCloseTo(0.21);
    expect(last(onChange)!.h).toBeCloseTo(0.11);
  });

  it("Delete removes the highlight", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("button", { name: /Highlight on step 3/ }).focus();
    await user.keyboard("{Delete}");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("button", { name: /Highlight on step 3/ })).not.toBeInTheDocument();
  });

  it("resizeFromCorner keeps the opposite corner and the minimum size", () => {
    const r = resizeFromCorner(START, "nw", -0.1, -0.1);
    expect(r.x + r.w).toBeCloseTo(0.7);
    expect(r.y + r.h).toBeCloseTo(0.6);
    expect(r.x).toBeCloseTo(0.4);
    const tiny = resizeFromCorner(START, "se", -1, -1);
    expect(tiny.w).toBeCloseTo(0.02);
    expect(tiny.x).toBeCloseTo(0.5);
    const out = resizeFromCorner(START, "ne", 5, -5);
    expect(out.x + out.w).toBeLessThanOrEqual(1);
    expect(out.y).toBe(0);
  });
});
