// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameGrabber, probeVideo, resolveDuration } from "./frames";

/** Just enough of an HTMLVideoElement for probeVideo and the frame grabber. */
class FakeVideo extends EventTarget {
  muted = false;
  playsInline = false;
  preload = "";
  readyState = 4;
  seeking = false;
  videoWidth = 1920;
  videoHeight = 1080;
  seeks: number[] = [];
  private time = 0;
  private source = "";
  constructor(public duration = 10) {
    super();
  }
  get src() {
    return this.source;
  }
  set src(v: string) {
    this.source = v;
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  }
  get currentTime() {
    return this.time;
  }
  set currentTime(v: number) {
    this.time = v;
    this.seeks.push(v);
  }
  removeAttribute() {}
  load() {}
}

let video: FakeVideo;

beforeEach(() => {
  video = new FakeVideo();
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, o?: ElementCreationOptions) =>
    tag === "video" ? (video as unknown as HTMLElement) : real(tag, o),
  );
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("probeVideo duration limit", () => {
  const mp4 = new File(["x"], "a.mp4", { type: "video/mp4" });

  it("accepts a real 10:00 recording that QuickTime reports as 600.03 s", async () => {
    video.duration = 600.03;
    await expect(probeVideo(mp4)).resolves.toMatchObject({ durationSec: 600.03, width: 1920 });
  });

  it("rejects clearly over 10:00 (600.6 s) as too_long", async () => {
    video.duration = 600.6;
    await expect(probeVideo(mp4)).rejects.toMatchObject({ kind: "too_long", detail: "10:01" });
  });
});

describe("resolveDuration error handling", () => {
  it("fails fast with undecodable on an error event while resolving Infinity", async () => {
    video.duration = Infinity;
    const p = resolveDuration(video as unknown as Parameters<typeof resolveDuration>[0], 60_000);
    video.dispatchEvent(new Event("error"));
    await expect(p).rejects.toMatchObject({ kind: "undecodable" });
  });
});

describe("createFrameGrabber", () => {
  const blob = new Blob(["x"]);

  it("times out a stuck seek as capture_failed", async () => {
    vi.useFakeTimers();
    const grabber = createFrameGrabber(blob);
    const result = expect(grabber.capture(5)).rejects.toMatchObject({ kind: "capture_failed" });
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    expect(video.seeks).toEqual([5]);
  });

  it("rejects capture_failed when the element errors mid-seek", async () => {
    const grabber = createFrameGrabber(blob);
    const result = expect(grabber.capture(5)).rejects.toMatchObject({ kind: "capture_failed" });
    await Promise.resolve();
    await Promise.resolve();
    video.dispatchEvent(new Event("error"));
    await result;
  });

  it("aborting mid-seek rejects with cancelled right away (no timers advanced)", async () => {
    vi.useFakeTimers();
    const grabber = createFrameGrabber(blob);
    const ctrl = new AbortController();
    const result = expect(grabber.capture(5, { signal: ctrl.signal })).rejects.toMatchObject({ kind: "cancelled" });
    await vi.advanceTimersByTimeAsync(10);
    ctrl.abort();
    await result;
  });

  it("an already-aborted signal rejects without seeking", async () => {
    const grabber = createFrameGrabber(blob);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(grabber.capture(5, { signal: ctrl.signal })).rejects.toMatchObject({ kind: "cancelled" });
    expect(video.seeks).toEqual([]);
  });

  it("dispose mid-capture rejects with cancelled, and later captures too", async () => {
    vi.useFakeTimers();
    const grabber = createFrameGrabber(blob);
    const result = expect(grabber.capture(5)).rejects.toMatchObject({ kind: "cancelled" });
    await vi.advanceTimersByTimeAsync(10);
    grabber.dispose();
    await result;
    await expect(grabber.capture(6)).rejects.toMatchObject({ kind: "cancelled" });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    grabber.dispose(); // idempotent
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("a failed capture does not break the queue", async () => {
    vi.useFakeTimers();
    const grabber = createFrameGrabber(blob);
    const first = expect(grabber.capture(5)).rejects.toMatchObject({ kind: "capture_failed" });
    const second = expect(grabber.capture(6)).rejects.toMatchObject({ kind: "capture_failed" });
    await vi.advanceTimersByTimeAsync(5000);
    await first;
    await vi.advanceTimersByTimeAsync(5000);
    await second;
    expect(video.seeks).toEqual([5, 6]);
  });
});
