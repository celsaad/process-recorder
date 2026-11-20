// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  describe("pointer drag", () => {
    let frames: FrameRequestCallback[] = [];
    const flushFrames = () =>
      act(() => {
        const queued = frames;
        frames = [];
        queued.forEach((cb) => cb(0));
      });

    beforeEach(() => {
      frames = [];
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal("cancelAnimationFrame", () => {});
      // The image frame is 1000 × 500 px, so 100 px = 0.1 wide and 50 px = 0.1 tall.
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 500 }),
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const box = () => screen.getByRole("button", { name: /Highlight on step 3/ }).parentElement!;

    it("updates a draft once per frame and commits once on pointer-up", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      const rect = screen.getByRole("button", { name: /Highlight on step 3/ });
      fireEvent.pointerDown(rect, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      expect(rect).toHaveFocus();
      fireEvent.pointerMove(rect, { clientX: 150, clientY: 125, pointerId: 1 });
      fireEvent.pointerMove(rect, { clientX: 200, clientY: 150, pointerId: 1 });
      expect(frames).toHaveLength(1); // batched into one frame
      expect(onChange).not.toHaveBeenCalled();
      flushFrames();
      expect(parseFloat(box().style.left)).toBeCloseTo(60);
      expect(parseFloat(box().style.top)).toBeCloseTo(60);
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.pointerUp(rect, { clientX: 200, clientY: 150, pointerId: 1 });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(last(onChange)!.x).toBeCloseTo(0.6);
      expect(last(onChange)!.y).toBeCloseTo(0.6);
      expect(last(onChange)!.w).toBeCloseTo(0.2);
    });

    it("pointercancel discards the draft without committing", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      const rect = screen.getByRole("button", { name: /Highlight on step 3/ });
      fireEvent.pointerDown(rect, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      fireEvent.pointerMove(rect, { clientX: 200, clientY: 150, pointerId: 1 });
      flushFrames();
      fireEvent.pointerCancel(rect, { pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      expect(parseFloat(box().style.left)).toBeCloseTo(50);
    });

    it("dragging a corner handle resizes from that corner", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      const rect = screen.getByRole("button", { name: /Highlight on step 3/ });
      act(() => rect.focus());
      const se = rect.querySelector<HTMLElement>('[data-handle="se"]')!;
      fireEvent.pointerDown(se, { clientX: 700, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(rect, { clientX: 800, clientY: 350, pointerId: 1 });
      fireEvent.pointerUp(rect, { pointerId: 1 });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(last(onChange)).toMatchObject({ x: 0.5, y: 0.5 });
      expect(last(onChange)!.w).toBeCloseTo(0.3);
      expect(last(onChange)!.h).toBeCloseTo(0.2);
    });
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
