// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureProject } from "@/fixtures/project";
import type { JobState, Recorder } from "@/lib/types";

// Each child component is another lane's; stand them in with markers that expose their props.
const marker = (name: string) =>
  function Marker(props: Record<string, unknown>) {
    const data = Object.fromEntries(
      Object.entries(props).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)),
    );
    return (
      <div data-testid={name} data-props={JSON.stringify(data)}>
        {props.children as React.ReactNode}
      </div>
    );
  };

vi.mock("@/components/editor/StepList", () => ({ StepList: marker("StepList") }));
vi.mock("@/components/feedback/Banner", () => ({ Banner: marker("Banner") }));
vi.mock("@/components/feedback/ConfirmDialog", () => ({ ConfirmDialog: marker("ConfirmDialog") }));
vi.mock("@/components/feedback/ErrorPanel", () => ({ ErrorPanel: marker("ErrorPanel") }));
vi.mock("@/components/frames/FramePicker", () => ({ FramePicker: marker("FramePicker") }));
vi.mock("@/components/project/ExportButton", () => ({ ExportButton: marker("ExportButton") }));
vi.mock("@/components/project/NoSteps", () => ({ NoSteps: marker("NoSteps") }));
vi.mock("@/components/project/ProjectTitle", () => ({ ProjectTitle: marker("ProjectTitle") }));
vi.mock("@/components/shell/AppHeader", () => ({ AppHeader: marker("AppHeader") }));
vi.mock("@/components/upload/CaptureBanner", () => ({ CaptureBanner: marker("CaptureBanner") }));
vi.mock("@/components/upload/EmptyState", () => ({ EmptyState: marker("EmptyState") }));
vi.mock("@/components/upload/JobProgress", () => ({ JobProgress: marker("JobProgress") }));

const rec = vi.hoisted(() => ({ current: null as unknown as Recorder }));
vi.mock("@/hooks/useProcessRecorder", () => ({
  useProcessRecorder: () => rec.current,
  longVideoNotice: (sec: number) => `long ${sec}`,
}));

const { default: Home } = await import("./page");

function recorder(job: JobState, over: Partial<Recorder> = {}): Recorder {
  const noop = () => {};
  const anoop = async () => {};
  return {
    job,
    project: job.phase === "idle" ? null : fixtureProject,
    steps: { steps: fixtureProject.steps, lastDeleted: null },
    dispatch: noop,
    shotUrls: {},
    videoUrl: "blob:video",
    saveStatus: "idle",
    storageFull: false,
    onFile: noop,
    retry: noop,
    cancel: noop,
    startNew: noop,
    confirmStartNew: anoop,
    pendingConfirm: null,
    resolveConfirm: noop,
    setTitle: noop,
    repick: anoop,
    addStep: anoop,
    exportDocx: anoop,
    ...over,
  };
}

const shown = (id: string) => screen.queryByTestId(id) !== null;
const props = (id: string) => JSON.parse(screen.getByTestId(id).dataset.props ?? "{}");
const running = (stage: Extract<JobState, { phase: "running" }>["stage"], capture?: { done: number; total: number }): JobState => ({
  phase: "running",
  stage,
  stageStartedAt: 0,
  completed: [],
  capture,
});

describe("Home page", () => {
  beforeEach(() => {
    rec.current = recorder({ phase: "idle" });
  });
  afterEach(cleanup);

  it("idle → EmptyState, no editor chrome", () => {
    render(<Home />);
    expect(shown("EmptyState")).toBe(true);
    expect(shown("ProjectTitle")).toBe(false);
    expect(shown("FramePicker")).toBe(false);
  });

  it("running (not capturing) → JobProgress", () => {
    rec.current = recorder(running("analyzing"));
    render(<Home />);
    expect(shown("JobProgress")).toBe(true);
    expect(shown("StepList")).toBe(false);
  });

  it("capturing → editor with CaptureBanner", () => {
    rec.current = recorder(running("capturing", { done: 1, total: 4 }));
    render(<Home />);
    expect(shown("StepList")).toBe(true);
    expect(props("CaptureBanner")).toEqual({ done: 1, total: 4 });
    expect(shown("JobProgress")).toBe(false);
  });

  it("ready → header with title and export, StepList, FramePicker (closed)", () => {
    rec.current = recorder({ phase: "ready" });
    render(<Home />);
    expect(props("ProjectTitle")).toEqual({ value: fixtureProject.title });
    expect(shown("ExportButton")).toBe(true);
    expect(shown("StepList")).toBe(true);
    expect(shown("CaptureBanner")).toBe(false);
    expect(props("FramePicker")).toMatchObject({ open: false, videoUrl: "blob:video" });
  });

  it("ready with zero steps → NoSteps", () => {
    rec.current = recorder({ phase: "ready" }, { steps: { steps: [], lastDeleted: null } });
    render(<Home />);
    expect(shown("NoSteps")).toBe(true);
    expect(shown("StepList")).toBe(false);
  });

  it("long video → info banner in the editor", () => {
    const long = { ...fixtureProject, video: { ...fixtureProject.video, durationSec: 326 } };
    rec.current = recorder({ phase: "ready" }, { project: long });
    render(<Home />);
    expect(props("Banner")).toMatchObject({ tone: "info" });
    expect(screen.getByTestId("Banner")).toHaveTextContent("long 326");
  });

  it("error → ErrorPanel, with the already-uploaded note when retrying analysis", () => {
    rec.current = recorder({ phase: "error", error: { kind: "rate_limited" }, retryFrom: "analyze" });
    render(<Home />);
    expect(shown("ErrorPanel")).toBe(true);
    expect(screen.getByTestId("ErrorPanel")).toHaveTextContent("Your video is already uploaded");
  });

  it("storage full → warning banner", () => {
    rec.current = recorder({ phase: "ready" }, { storageFull: true });
    render(<Home />);
    expect(screen.getAllByTestId("Banner")[0]).toHaveTextContent("Changes won't survive a refresh");
  });

  it("ConfirmDialog follows pendingConfirm", () => {
    rec.current = recorder({ phase: "ready" }, { pendingConfirm: "replace" });
    render(<Home />);
    expect(props("ConfirmDialog")).toEqual({ open: true, kind: "replace" });
  });
});
