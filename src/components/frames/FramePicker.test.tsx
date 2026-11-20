// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { LiveRegionProvider } from "@/components/shell/LiveRegion";
import { AppError } from "@/lib/errors";
import { FramePicker } from "./FramePicker";

const captureFromVideo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/frames", async (importOriginal) => ({
  // Keep the real waitForFrameData (it polls readyState, which the tests drive); fake only the capture.
  ...(await importOriginal<typeof import("@/lib/frames")>()),
  captureFromVideo,
}));

// jsdom never decodes video; tests flip this to simulate "frame ready" (4) or "still loading" (0).
let readyState = 4;

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => readyState });
  // Radix's slider measures its thumb with ResizeObserver, which jsdom lacks.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  readyState = 4;
  cleanup();
  captureFromVideo.mockReset();
});

const shot = new Blob(["frame"], { type: "image/webp" });

function Harness({
  onConfirm = vi.fn(),
  onCancel = vi.fn(),
  removeOpenerOnOpen = false,
}: {
  onConfirm?: (sec: number, shot: Blob) => void | Promise<void>;
  onCancel?: () => void;
  removeOpenerOnOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openerGone, setOpenerGone] = useState(false);
  return (
    <LiveRegionProvider>
      <h3 id="step-3-heading" tabIndex={-1}>
        Step 3
      </h3>
      {!openerGone && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            if (removeOpenerOnOpen) setOpenerGone(true);
          }}
        >
          Pick frame for step 3
        </button>
      )}
      <FramePicker
        open={open}
        videoUrl="blob:video"
        durationSec={326}
        initialSec={19}
        stepNumber={3}
        onConfirm={async (sec, s) => {
          await onConfirm(sec, s);
          setOpen(false);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    </LiveRegionProvider>
  );
}

async function openPicker() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Pick frame for step 3" }));
  const slider = await screen.findByRole("slider", { name: /step 3/ });
  return { user, slider };
}

describe("FramePicker", () => {
  it("opens on the step's timestamp with the slider focused", async () => {
    const { slider } = await openPicker();
    expect(screen.getByRole("dialog", { name: "Pick a frame for step 3" })).toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-valuenow", "19");
    expect(slider).toHaveFocus();
  });

  it("steps 0.1 s with arrows and 1 s with Shift+arrows", async () => {
    const { user, slider } = await openPicker();
    await user.keyboard("{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "19.1");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(slider).toHaveAttribute("aria-valuenow", "18.9");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(slider).toHaveAttribute("aria-valuenow", "19.9");
    await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}");
    expect(slider).toHaveAttribute("aria-valuenow", "17.9");
  });

  it("marks the original timestamp, offset for the thumb inset", async () => {
    await openPicker();
    expect(screen.getByText("Original 0:19")).toBeInTheDocument();
    const marker = screen.getByTestId("original-marker");
    // jsdom folds the calc: 11px + (100% - 22px) * p  =>  p*100 % + (11 - 22p) px
    const p = 19 / 326;
    const [, pct, px] = /calc\(([\d.]+)% \+ ([\d.]+)px\)/.exec(marker.style.left) ?? [];
    expect(Number(pct)).toBeCloseTo(p * 100, 3);
    expect(Number(px)).toBeCloseTo(11 - 22 * p, 3);
  });

  it("names the controls with their step number", async () => {
    await openPicker();
    for (const name of ["−1 s for step 3", "−0.1 s for step 3", "+0.1 s for step 3", "+1 s for step 3", "Use this frame for step 3"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/Video frame at 0:19\.0 for step 3/)).toBeInTheDocument();
  });

  it("Enter on a step button only steps", async () => {
    const { user } = await openPicker();
    screen.getByRole("button", { name: "+0.1 s for step 3" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "19.1");
    expect(captureFromVideo).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("step buttons clamp to the video length", async () => {
    const { user } = await openPicker();
    await user.keyboard("{End}");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "326");
    await user.click(screen.getByRole("button", { name: "+1 s for step 3" }));
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "326");
  });

  it("Enter on the slider captures the frame and confirms with the time", async () => {
    captureFromVideo.mockResolvedValue(shot);
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Pick frame for step 3" }));
    await screen.findByRole("slider");
    await user.keyboard("{ArrowRight}{Enter}");
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(19.1, shot));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Esc cancels and focus returns to the trigger", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCancel={onCancel} />);
    const trigger = screen.getByRole("button", { name: "Pick frame for step 3" });
    await user.click(trigger);
    await screen.findByRole("slider");
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps the dialog open and shows a message when capture fails", async () => {
    captureFromVideo.mockRejectedValue(new AppError("capture_failed"));
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Pick frame for step 3" }));
    await screen.findByRole("slider");
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/Couldn.t capture this frame/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    await openPicker();
    expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations();
  });

  it("Esc and outside clicks are ignored while a capture is in flight, and the capture still commits once", async () => {
    let finish!: (b: Blob) => void;
    captureFromVideo.mockReturnValue(new Promise<Blob>((r) => (finish = r)));
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Pick frame for step 3" }));
    await screen.findByRole("slider");
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    fireEvent.pointerDown(document.querySelector("[data-slot=dialog-overlay]")!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => finish(shot));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("never confirms after the dialog was unmounted mid-capture", async () => {
    let finish!: (b: Blob) => void;
    captureFromVideo.mockReturnValue(new Promise<Blob>((r) => (finish = r)));
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Pick frame for step 3" }));
    await screen.findByRole("slider");
    await user.keyboard("{Enter}");
    unmount();
    await act(async () => finish(shot));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Enter before the frame is decoded waits for frame data instead of failing", async () => {
    readyState = 0;
    captureFromVideo.mockResolvedValue(shot);
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Pick frame for step 3" }));
    await screen.findByRole("slider");
    await user.keyboard("{Enter}");
    expect(captureFromVideo).not.toHaveBeenCalled();
    readyState = 4;
    fireEvent(screen.getByLabelText(/Video frame at/), new Event("loadeddata"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(19, shot));
  });

  it("returns focus to the opener after a confirm", async () => {
    captureFromVideo.mockResolvedValue(shot);
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Pick frame for step 3" });
    await user.click(trigger);
    await screen.findByRole("slider");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("falls back to the step heading when the opener is gone", async () => {
    captureFromVideo.mockResolvedValue(shot);
    const user = userEvent.setup();
    render(<Harness removeOpenerOnOpen />);
    await user.click(screen.getByRole("button", { name: "Pick frame for step 3" }));
    await screen.findByRole("slider");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.getElementById("step-3-heading")).toHaveFocus());
  });
});
