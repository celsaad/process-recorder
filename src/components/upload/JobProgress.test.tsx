// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { LiveRegionProvider } from "@/components/shell/LiveRegion";
import type { RunningJob } from "@/lib/ui-contracts";
import type { VideoInfo } from "@/lib/types";
import { JobProgress } from "./JobProgress";
import { CaptureBanner } from "./CaptureBanner";

const video: VideoInfo = {
  name: "create-purchase-order.mp4",
  sizeBytes: 3_145_728,
  mimeType: "video/mp4",
  durationSec: 78,
  width: 1600,
  height: 1000,
};

const running = (over: Partial<RunningJob> = {}): RunningJob => ({
  phase: "running",
  stage: "gemini_processing",
  stageStartedAt: Date.now(),
  completed: ["validating", "received", "sending_to_gemini"],
  ...over,
});

function ui(job: RunningJob, v: VideoInfo = video, onCancel = vi.fn()) {
  return (
    <LiveRegionProvider>
      <JobProgress job={job} video={v} onCancel={onCancel} />
    </LiveRegionProvider>
  );
}

describe("JobProgress", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("marks done / active / waiting stages with text, not colour alone", async () => {
    const { container } = render(ui(running()));
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.dataset.status)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(within(items[0]).getByText("Done")).toBeInTheDocument();
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[2]).toHaveTextContent(/Gemini processing \(in progress\)/);
    expect(within(items[3]).getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("validating: no duration while it's still 0 (the probe hasn't finished)", () => {
    const job = running({ stage: "validating", completed: [] });
    const { rerender } = render(ui(job, { ...video, durationSec: 0 }));
    expect(screen.getByRole("heading", { name: "Checking your recording" })).toBeInTheDocument();
    expect(screen.getByText(/^3 MB$/)).toBeInTheDocument();
    expect(screen.queryByText(/0:00/)).toBeNull();
    rerender(ui(job, video));
    expect(screen.getByText("3 MB · 1:18")).toBeInTheDocument();
  });

  it("Cancel calls onCancel", async () => {
    const onCancel = vi.fn();
    render(ui(running(), video, onCancel));
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("ticks the elapsed time outside the live region and announces nothing itself", () => {
    vi.useFakeTimers();
    render(ui(running({ stageStartedAt: Date.now() })));
    const elapsed = screen.getByTestId("elapsed");
    expect(elapsed).toHaveTextContent("Elapsed 0:00");
    act(() => vi.advanceTimersByTime(3000));
    expect(elapsed).toHaveTextContent("0:03");
    const region = screen.getByTestId("live-region");
    expect(region).not.toContainElement(elapsed);
    expect(elapsed.closest("[aria-live]")).toBeNull();
    expect(region).toHaveTextContent("");
  });

  it("shows the long-video notice only over 3:00 (D16)", () => {
    const { rerender } = render(ui(running()));
    expect(screen.queryByText(/Longer recordings take longer/)).toBeNull();
    rerender(ui(running(), { ...video, durationSec: 326 }));
    expect(screen.getByText(/This recording is 5:26\. Longer recordings take longer/)).toBeInTheDocument();
  });

  it("shows the capture count on the Screenshots stage", () => {
    render(
      ui(
        running({
          stage: "capturing",
          completed: ["validating", "received", "sending_to_gemini", "gemini_processing", "analyzing"],
          capture: { done: 2, total: 4 },
        }),
      ),
    );
    expect(screen.getByText("Screenshot 3 of 4.")).toBeInTheDocument();
  });
});

describe("CaptureBanner", () => {
  it("shows progress without a live region of its own", async () => {
    const { container } = render(<CaptureBanner done={2} total={4} />);
    expect(screen.getByText("Screenshots 2 of 4")).toBeInTheDocument();
    expect(container.querySelector("[aria-live],[role=status],[role=alert]")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
