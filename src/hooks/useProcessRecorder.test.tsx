// @vitest-environment jsdom
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRegionProvider } from "@/components/shell/LiveRegion";
import type { FakeApiClient, FakeApiOptions, FakePersistence } from "@/fixtures/fakes";
import type { DebouncedSaver, DebouncedSaverOptions } from "@/lib/persistence";
import type { Project, Recorder, Step, StepsAction, StepsState } from "@/lib/types";

type FramesFake = ReturnType<typeof import("@/fixtures/fakes").createFakeFrames>;

// The real modules are other lanes' stubs: route every call to the in-memory fakes.
const fx = vi.hoisted(() => ({}) as { persistence: FakePersistence; api: FakeApiClient; frames: FramesFake });

vi.mock("@/lib/persistence", () => ({
  loadAll: () => fx.persistence.loadAll(),
  saveProjectNow: (...a: Parameters<FakePersistence["saveProjectNow"]>) => fx.persistence.saveProjectNow(...a),
  createDebouncedSaver: (...a: Parameters<FakePersistence["createDebouncedSaver"]>) =>
    fx.persistence.createDebouncedSaver(...a),
  saveVideo: (...a: Parameters<FakePersistence["saveVideo"]>) => fx.persistence.saveVideo(...a),
  saveShot: (...a: Parameters<FakePersistence["saveShot"]>) => fx.persistence.saveShot(...a),
  loadShot: (...a: Parameters<FakePersistence["loadShot"]>) => fx.persistence.loadShot(...a),
  clearAll: () => fx.persistence.clearAll(),
}));

vi.mock("@/lib/api-client", () => ({
  uploadVideo: (...a: Parameters<FakeApiClient["uploadVideo"]>) => fx.api.uploadVideo(...a),
  analyzeVideo: (...a: Parameters<FakeApiClient["analyzeVideo"]>) => fx.api.analyzeVideo(...a),
  deleteGeminiFile: (...a: Parameters<FakeApiClient["deleteGeminiFile"]>) => fx.api.deleteGeminiFile(...a),
}));

vi.mock("@/lib/frames", () => ({
  validateFile: (...a: Parameters<FramesFake["validateFile"]>) => fx.frames.validateFile(...a),
  probeVideo: (...a: Parameters<FramesFake["probeVideo"]>) => fx.frames.probeVideo(...a),
  createFrameGrabber: (...a: Parameters<FramesFake["createFrameGrabber"]>) => fx.frames.createFrameGrabber(...a),
  captureFromVideo: (...a: Parameters<FramesFake["captureFromVideo"]>) => fx.frames.captureFromVideo(...a),
}));

vi.mock("@/lib/export-docx", () => ({
  buildDocx: vi.fn(async () => new Blob(["docx"])),
  downloadBlob: vi.fn(),
  exportFilename: (title: string) => `${title.toLowerCase().replace(/\s+/g, "-")}.docx`,
}));

// Lane E's reducer is still a stub: a minimal working one for the actions the hook uses.
vi.mock("@/lib/steps-reducer", () => {
  const initialSteps: StepsState = { steps: [], lastDeleted: null };
  const patch = (s: StepsState, id: string, p: Partial<Step>): StepsState => ({
    ...s,
    steps: s.steps.map((x) => (x.id === id ? { ...x, ...p } : x)),
  });
  function stepsReducer(s: StepsState, a: StepsAction): StepsState {
    switch (a.type) {
      case "load":
        return { steps: a.steps, lastDeleted: null };
      case "update":
        return patch(s, a.id, a.patch);
      case "add": {
        const i = a.afterId ? s.steps.findIndex((x) => x.id === a.afterId) + 1 : 0;
        return { ...s, steps: [...s.steps.slice(0, i), a.step, ...s.steps.slice(i)] };
      }
      case "setTimestamp":
        return patch(s, a.id, { timestampSec: a.timestampSec });
      case "setCaptureState":
        return patch(s, a.id, { captureState: a.captureState });
      default:
        return s;
    }
  }
  return { initialSteps, stepsReducer };
});

const { createFakeApiClient, createFakeFrames, createFakePersistence } = await import("@/fixtures/fakes");
const { fixtureProject } = await import("@/fixtures/project");
const { RESULTS_HEADING_ID } = await import("@/lib/ui-contracts");
const { useProcessRecorder, retryFromFor } = await import("./useProcessRecorder");
const exportDocx = await import("@/lib/export-docx");

let apiOptions: FakeApiOptions;
let urlCount = 0;
const revoke = vi.fn();

function setup(api: FakeApiOptions = {}, frames: Parameters<typeof createFakeFrames>[0] = {}) {
  apiOptions = { delayMs: 5, ...api };
  fx.api = createFakeApiClient(apiOptions);
  fx.frames = createFakeFrames({ delayMs: 1, ...frames });
}

const wrapper = ({ children }: { children: ReactNode }) => <LiveRegionProvider>{children}</LiveRegionProvider>;
const render = () => renderHook(() => useProcessRecorder(), { wrapper });
const video = () => new File([new Uint8Array(64)], "create-po.mp4", { type: "video/mp4" });
const liveRegion = () => screen.getByTestId("live-region");

type Result = { current: Recorder };
const waitForPhase = (result: Result, phase: Recorder["job"]["phase"]) =>
  waitFor(() => expect(result.current.job.phase).toBe(phase), { timeout: 3000 });

beforeEach(() => {
  urlCount = 0;
  revoke.mockClear();
  URL.createObjectURL = vi.fn(() => `blob:test/${++urlCount}`);
  URL.revokeObjectURL = revoke;
  fx.persistence = createFakePersistence({}, { delayMs: 1 });
  setup();
});

afterEach(async () => {
  // Unmount (which aborts any job still running) so no work leaks into the next test's fakes.
  cleanup();
  await new Promise((r) => setTimeout(r, 5));
  document.body.innerHTML = "";
});

describe("useProcessRecorder", () => {
  it("happy path: upload → analyze → persist → capture → ready, focus and announce", async () => {
    const heading = document.createElement("h1");
    heading.id = RESULTS_HEADING_ID;
    heading.tabIndex = -1;
    document.body.append(heading);

    const { result } = render();
    const stages = new Set<string>();
    act(() => result.current.onFile(video()));

    await waitFor(
      () => {
        const j = result.current.job;
        if (j.phase === "running") stages.add(j.stage);
        expect(j.phase).toBe("ready");
      },
      { timeout: 3000, interval: 1 },
    );

    expect(stages.has("analyzing")).toBe(true);
    expect(fx.api.calls).toMatchObject({ upload: 1, analyze: 1 });
    expect(result.current.project?.title).toBe("Create a purchase order");
    expect(result.current.project?.gemini?.fileName).toBe("files/fake0001");
    expect(result.current.steps.steps).toHaveLength(4);
    expect(result.current.steps.steps.every((s) => s.captureState === "ok")).toBe(true);
    expect(Object.keys(result.current.shotUrls)).toHaveLength(4);
    expect(result.current.videoUrl).toMatch(/^blob:/);

    // Persisted for the first time before capture; shots and the video under their own keys.
    expect(fx.persistence.store.project?.steps).toHaveLength(4);
    expect(fx.persistence.store.video).not.toBeNull();
    expect(fx.persistence.store.shots.size).toBe(4);

    expect(document.activeElement).toBe(heading);
    await waitFor(() => expect(liveRegion()).toHaveTextContent("4 steps ready"));
  });

  it("shows capture progress while capturing", async () => {
    setup({}, { delayMs: 30 });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitFor(() => {
      const j = result.current.job;
      expect(j.phase === "running" && j.stage === "capturing" && j.capture && j.capture.done >= 1).toBe(true);
    });
    const j = result.current.job;
    expect(j.phase === "running" && j.capture?.total).toBe(4);
    await waitForPhase(result, "ready");
  });

  it("cancel while capturing keeps the project and finishes with the rest marked failed", async () => {
    setup({}, { delayMs: 40 });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitFor(() => {
      const j = result.current.job;
      expect(j.phase === "running" && j.capture && j.capture.done >= 1).toBe(true);
    });
    act(() => result.current.cancel());
    await waitForPhase(result, "ready");
    const states = result.current.steps.steps.map((s) => s.captureState);
    expect(states[0]).toBe("ok");
    expect(states).toContain("failed");
    expect(states).not.toContain("pending");
    expect(fx.persistence.store.project).not.toBeNull();
  });

  it("cancel mid-upload aborts, returns to idle and announces Cancelled", async () => {
    setup({ delayMs: 200 });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitFor(() => {
      const j = result.current.job;
      expect(j.phase === "running" && j.stage === "received").toBe(true);
    });

    act(() => result.current.cancel());

    expect(result.current.job).toEqual({ phase: "idle" });
    expect(result.current.project).toBeNull();
    await waitFor(() => expect(liveRegion()).toHaveTextContent("Cancelled"));
    await new Promise((r) => setTimeout(r, 300));
    expect(result.current.job).toEqual({ phase: "idle" });
    expect(fx.api.calls.analyze).toBe(0);
    expect(fx.persistence.store.video).toBeNull();
  });

  it("analyze failure → Retry re-analyzes the stored fileName without re-uploading", async () => {
    setup({ analyzeError: { kind: "rate_limited" } });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "error");
    expect(result.current.job).toEqual({ phase: "error", error: { kind: "rate_limited" }, retryFrom: "analyze" });

    delete apiOptions.analyzeError;
    const analyze = vi.spyOn(fx.api, "analyzeVideo");
    act(() => result.current.retry());
    await waitForPhase(result, "ready");

    expect(fx.api.calls).toMatchObject({ upload: 1, analyze: 2 });
    expect(analyze).toHaveBeenCalledWith("files/fake0001", expect.anything());
    expect(result.current.steps.steps).toHaveLength(4);
  });

  it("a network error during analysis retries from analyze (job.retryFrom beats the per-kind default)", async () => {
    setup({ analyzeError: { kind: "network" } });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "error");
    expect(result.current.job).toMatchObject({ retryFrom: "analyze" });

    delete apiOptions.analyzeError;
    act(() => result.current.retry());
    await waitForPhase(result, "ready");
    expect(fx.api.calls.upload).toBe(1);
  });

  it("file_expired → Retry re-uploads from the stored video", async () => {
    setup({ analyzeError: { kind: "file_expired" } });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "error");
    expect(result.current.job).toMatchObject({ retryFrom: "upload" });

    delete apiOptions.analyzeError;
    act(() => result.current.retry());
    await waitForPhase(result, "ready");
    expect(fx.api.calls).toMatchObject({ upload: 2, analyze: 2 });
  });

  it("an upload failure retries from upload", async () => {
    setup({ uploadError: { kind: "gemini_failed" } });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "error");
    expect(result.current.job).toMatchObject({ retryFrom: "upload" });

    delete apiOptions.uploadError;
    act(() => result.current.retry());
    await waitForPhase(result, "ready");
    expect(fx.api.calls).toMatchObject({ upload: 2, analyze: 1 });
  });

  it("validation errors fail fast without uploading and are not retryable", async () => {
    const { result } = render();
    act(() => result.current.onFile(new File(["x"], "notes.pdf", { type: "application/pdf" })));
    await waitForPhase(result, "error");
    expect(result.current.job).toEqual({
      phase: "error",
      error: { kind: "unsupported_type", detail: ".pdf" },
      retryFrom: null,
    });
    expect(fx.api.calls.upload).toBe(0);
  });

  it("zero steps still succeeds (the page shows NoSteps)", async () => {
    setup({ analyzeResult: { processTitle: "Nothing here", steps: [] } });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "ready");
    expect(result.current.steps.steps).toEqual([]);
    await waitFor(() => expect(liveRegion().textContent).toBe("No steps found. Add a step manually."));
  });

  it("a failed capture marks only that step", async () => {
    setup({}, { failAt: [17] });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "ready");
    expect(result.current.steps.steps.map((s) => s.captureState)).toEqual(["ok", "failed", "ok", "ok"]);
  });

  it("restores the last project on mount, with shots as object URLs", async () => {
    fx.persistence = createFakePersistence({ project: fixtureProject, video: new Blob(["v"]) }, { delayMs: 1 });
    for (const s of fixtureProject.steps) await fx.persistence.saveShot(s.id, new Blob([s.id]));

    const { result } = render();
    await waitForPhase(result, "ready");

    expect(result.current.project?.title).toBe(fixtureProject.title);
    expect(result.current.steps.steps.map((s) => s.id)).toEqual(fixtureProject.steps.map((s) => s.id));
    expect(Object.keys(result.current.shotUrls).sort()).toEqual(fixtureProject.steps.map((s) => s.id).sort());
    expect(result.current.videoUrl).toMatch(/^blob:/);
    await waitFor(() => expect(liveRegion()).toHaveTextContent("Restored your last project"));
    expect(fx.api.calls.upload).toBe(0);
  });

  it("restored steps without a stored shot become failed (Pick frame)", async () => {
    fx.persistence = createFakePersistence({ project: fixtureProject, video: new Blob(["v"]) }, { delayMs: 1 });
    await fx.persistence.saveShot("step-1", new Blob(["1"]));
    const { result } = render();
    await waitForPhase(result, "ready");
    expect(result.current.steps.steps.map((s) => s.captureState)).toEqual(["ok", "failed", "failed", "failed"]);
  });

  it("autosaves title edits through the debounced saver", async () => {
    fx.persistence = createFakePersistence({ project: fixtureProject, video: new Blob(["v"]) }, { delayMs: 1 });
    const { result } = render();
    await waitForPhase(result, "ready");

    act(() => result.current.setTitle("Raise a PO"));
    await waitFor(() => expect(result.current.saveStatus).toBe("saved"), { timeout: 2000 });
    expect(fx.persistence.store.project?.title).toBe("Raise a PO");
  });

  it("start new: confirm → delete the Gemini file → clear storage → revoke URLs → idle", async () => {
    fx.persistence = createFakePersistence({ project: fixtureProject, video: new Blob(["v"]) }, { delayMs: 1 });
    for (const s of fixtureProject.steps) await fx.persistence.saveShot(s.id, new Blob([s.id]));
    const { result } = render();
    await waitForPhase(result, "ready");

    act(() => result.current.startNew());
    expect(result.current.pendingConfirm).toBe("start_new");
    act(() => result.current.resolveConfirm(false));
    expect(result.current.pendingConfirm).toBeNull();
    expect(result.current.job.phase).toBe("ready");

    act(() => result.current.startNew());
    await act(async () => result.current.resolveConfirm(true));
    await waitForPhase(result, "idle");

    expect(fx.api.calls.delete).toEqual([fixtureProject.gemini!.fileName]);
    expect(fx.persistence.store.project).toBeNull();
    expect(fx.persistence.store.shots.size).toBe(0);
    expect(revoke).toHaveBeenCalledTimes(5); // 4 shots + the video
    expect(result.current.project).toBeNull();
    expect(result.current.shotUrls).toEqual({});
    expect(result.current.videoUrl).toBeNull();
  });

  it("a new file over an existing project asks to replace it first", async () => {
    fx.persistence = createFakePersistence({ project: fixtureProject, video: new Blob(["v"]) }, { delayMs: 1 });
    const { result } = render();
    await waitForPhase(result, "ready");

    act(() => result.current.onFile(video()));
    await waitFor(() => expect(result.current.pendingConfirm).toBe("replace"));
    expect(result.current.pendingFileName).toBe(video().name); // the dialog names the file
    act(() => result.current.resolveConfirm(false));
    expect(result.current.pendingFileName).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(fx.api.calls.upload).toBe(0);
    expect(result.current.project?.id).toBe(fixtureProject.id);

    act(() => result.current.onFile(video()));
    await waitFor(() => expect(result.current.pendingConfirm).toBe("replace"));
    act(() => result.current.resolveConfirm(true));
    await waitFor(() => expect(fx.api.calls.upload).toBe(1));
    await waitForPhase(result, "ready");
    expect(fx.api.calls.delete).toEqual([fixtureProject.gemini!.fileName]);
    expect(result.current.project?.gemini?.fileName).toBe("files/fake0001");
  });

  it("repick stores the new shot and timestamp; addStep captures at prev + 1 s", async () => {
    fx.persistence = createFakePersistence({ project: fixtureProject, video: new Blob(["v"]) }, { delayMs: 1 });
    const { result } = render();
    await waitForPhase(result, "ready");

    const shot = new Blob(["new"], { type: "image/webp" });
    await act(() => result.current.repick("step-2", 20, shot));
    expect(result.current.steps.steps[1]).toMatchObject({ timestampSec: 20, captureState: "ok" });
    expect(fx.persistence.store.shots.get("step-2")).toBe(shot);
    expect(result.current.shotUrls["step-2"]).toMatch(/^blob:/);

    await act(() => result.current.addStep("step-2"));
    const added = result.current.steps.steps[2];
    expect(added).toMatchObject({ timestampSec: 21, captureState: "ok", action: "" });
    expect(fx.persistence.store.shots.has(added.id)).toBe(true);
  });

  it("exportDocx builds from the current steps and downloads with the title's filename", async () => {
    fx.persistence = createFakePersistence({ project: fixtureProject, video: new Blob(["v"]) }, { delayMs: 1 });
    const { result } = render();
    await waitForPhase(result, "ready");
    await act(() => result.current.exportDocx());
    expect(exportDocx.buildDocx).toHaveBeenCalledWith(
      expect.objectContaining({ title: fixtureProject.title }),
      result.current.steps.steps,
      expect.any(Function),
    );
    expect(exportDocx.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "create-a-purchase-order.docx");
  });

  it("exportDocx clicked mid-capture waits for every screenshot before building the document", async () => {
    setup({}, { delayMs: 40 }); // slow captures: 4 steps x 40 ms
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitFor(
      () => {
        const j = result.current.job;
        expect(j.phase === "running" && j.stage === "capturing" && (j.capture?.done ?? 0) < 4).toBe(true);
      },
      { timeout: 3000, interval: 1 },
    );
    vi.mocked(exportDocx.buildDocx).mockClear();
    await act(() => result.current.exportDocx());
    expect(exportDocx.buildDocx).toHaveBeenCalledTimes(1);
    const [, steps] = vi.mocked(exportDocx.buildDocx).mock.calls[0];
    expect(steps).toHaveLength(4);
    expect(steps.every((st) => st.captureState === "ok")).toBe(true);
  });
});

/** Lane B's saver semantics: after cancel(), flush() still waits for a write already running. */
function chainedSaver(opts: DebouncedSaverOptions = {}): DebouncedSaver {
  let chain = Promise.resolve();
  let pending: Project | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gen = 0;
  const flush = () => {
    clearTimeout(timer);
    const p = pending;
    if (!p) return chain;
    pending = null;
    const g = gen;
    chain = chain.then(async () => {
      if (g !== gen) return;
      opts.onStatus?.("saving");
      await fx.persistence.saveProjectNow(p);
      opts.onStatus?.("saved");
    });
    return chain;
  };
  return {
    schedule: (p: Project) => {
      pending = p;
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), opts.ms ?? 500);
    },
    flush,
    cancel: () => {
      clearTimeout(timer);
      pending = null;
      gen++;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const restoredStore = (delayMs = 1) =>
  createFakePersistence({ project: fixtureProject, video: new Blob(["v"]) }, { delayMs });

describe("useProcessRecorder: races and lifecycle", () => {
  it("cancel during analysis returns to idle, deletes the Gemini file and leaves nothing stored", async () => {
    setup({ delayMs: 60 });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitFor(() => expect(result.current.job).toMatchObject({ phase: "running", stage: "analyzing" }));

    act(() => result.current.cancel());
    expect(result.current.job).toEqual({ phase: "idle" });
    await sleep(200);
    expect(result.current.job).toEqual({ phase: "idle" });
    expect(fx.api.calls.delete).toEqual(["files/fake0001"]);
    expect(fx.persistence.store).toMatchObject({ project: null, video: null });
    await waitFor(() => expect(liveRegion()).toHaveTextContent("Cancelled"));
  });

  it("cancel during the first persist: no 'Saved', nothing stored, and the next file isn't a 'replace'", async () => {
    fx.persistence = createFakePersistence({}, { delayMs: 150 });
    const { result } = render();
    await sleep(200); // restore finds nothing
    act(() => result.current.onFile(video()));
    await waitFor(() => expect(result.current.saveStatus).toBe("saving"), { timeout: 3000 });

    act(() => result.current.cancel());
    await sleep(400); // the in-flight saveProjectNow lands, then teardown's clearAll
    expect(result.current.job).toEqual({ phase: "idle" });
    expect(result.current.saveStatus).toBe("idle");
    expect(fx.persistence.store.project).toBeNull();

    act(() => result.current.onFile(video()));
    await waitFor(() => expect(fx.api.calls.upload).toBe(2), { timeout: 3000 });
    expect(result.current.pendingConfirm).toBeNull();
  });

  it("a file dropped while a job runs is ignored", async () => {
    setup({ delayMs: 30 });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitFor(() => expect(result.current.job.phase).toBe("running"));
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "ready");
    expect(fx.api.calls).toMatchObject({ upload: 1, analyze: 1 });
  });

  it("a file dropped before restore resolves waits for it, then asks to replace", async () => {
    fx.persistence = restoredStore(100);
    const { result } = render();
    act(() => result.current.onFile(video())); // loadAll still pending
    await waitFor(() => expect(result.current.pendingConfirm).toBe("replace"), { timeout: 2000 });
    expect(fx.api.calls.upload).toBe(0);

    act(() => result.current.resolveConfirm(true));
    await waitForPhase(result, "running");
    await waitForPhase(result, "ready");
    expect(fx.api.calls.delete).toEqual([fixtureProject.gemini!.fileName]);
    expect(fx.persistence.store.project?.gemini?.fileName).toBe("files/fake0001");
    expect(fx.persistence.store.project?.steps.map((s) => s.id)).not.toContain("step-1");
  });

  it("choosing another file after a failed analysis deletes the earlier Gemini file", async () => {
    setup({ analyzeError: { kind: "rate_limited" } });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "error");

    delete apiOptions.analyzeError;
    act(() => result.current.onFile(video()));
    await waitForPhase(result, "ready");
    expect(result.current.pendingConfirm).toBeNull();
    expect(fx.api.calls.delete).toEqual(["files/fake0001"]);
    expect(fx.api.calls.upload).toBe(2);
  });

  it("start new while a save is in flight: the late write can't resurrect the project", async () => {
    fx.persistence = restoredStore(150);
    fx.persistence.createDebouncedSaver = chainedSaver;
    const { result } = render();
    await waitForPhase(result, "ready");

    act(() => result.current.setTitle("Edited"));
    await waitFor(() => expect(result.current.saveStatus).toBe("saving"), { timeout: 2000 });
    act(() => result.current.startNew());
    await act(async () => result.current.resolveConfirm(true));
    await sleep(400);
    expect(result.current.job).toEqual({ phase: "idle" });
    expect(fx.persistence.store.project).toBeNull();
  });

  it("pagehide flushes the pending save immediately", async () => {
    fx.persistence = restoredStore();
    const { result } = render();
    await waitForPhase(result, "ready");

    act(() => result.current.setTitle("Flushed"));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    await waitFor(() => expect(fx.persistence.store.project?.title).toBe("Flushed"), { timeout: 200 });
  });

  it("StrictMode: restores once and the effect re-run doesn't revoke live URLs", async () => {
    fx.persistence = restoredStore();
    for (const s of fixtureProject.steps) await fx.persistence.saveShot(s.id, new Blob([s.id]));
    const strict = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <LiveRegionProvider>{children}</LiveRegionProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useProcessRecorder(), { wrapper: strict });
    await waitForPhase(result, "ready");
    await sleep(20);
    expect(Object.keys(result.current.shotUrls)).toHaveLength(4);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("unmount revokes every object URL", async () => {
    fx.persistence = restoredStore();
    for (const s of fixtureProject.steps) await fx.persistence.saveShot(s.id, new Blob([s.id]));
    const { result, unmount } = render();
    await waitForPhase(result, "ready");
    unmount();
    await sleep(10);
    expect(revoke).toHaveBeenCalledTimes(5);
  });

  it("cancel while capturing announces 'Capture stopped' with the summary", async () => {
    setup({}, { delayMs: 40 });
    const { result } = render();
    act(() => result.current.onFile(video()));
    await waitFor(() => {
      const j = result.current.job;
      expect(j.phase === "running" && j.capture && j.capture.done >= 1).toBe(true);
    });
    act(() => result.current.cancel());
    await waitForPhase(result, "ready");
    await waitFor(() => expect(liveRegion().textContent).toBe("Capture stopped. 4 steps ready"));
  });
});

describe("retryFromFor", () => {
  it.each([
    ["network", "received", "upload"],
    ["network", "analyzing", "analyze"],
    ["gemini_failed", "gemini_processing", "upload"],
    ["gemini_failed", "analyzing", "analyze"],
    ["rate_limited", "analyzing", "analyze"],
    ["file_expired", "analyzing", "upload"],
    ["not_screen_recording", "analyzing", null],
    ["unsupported_type", "validating", null],
  ] as const)("%s at %s → %s", (kind, stage, expected) => {
    expect(retryFromFor(kind, stage)).toBe(expected);
  });
});

