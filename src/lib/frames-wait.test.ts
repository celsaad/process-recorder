import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForFrameData } from "./frames";

type FakeVideo = { readyState: number; seeking: boolean; error: unknown };
const asVideo = (v: FakeVideo) => v as unknown as HTMLVideoElement;

describe("waitForFrameData", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves immediately when the frame is already decoded", async () => {
    await expect(waitForFrameData(asVideo({ readyState: 4, seeking: false, error: null }), 1000)).resolves.toBeUndefined();
  });

  it("waits while readyState < 2, without relying on loadeddata (which never re-fires after a seek)", async () => {
    const v: FakeVideo = { readyState: 1, seeking: false, error: null };
    let done = false;
    const p = waitForFrameData(asVideo(v), 1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    v.readyState = 4; // data arrives; no event is dispatched
    await vi.advanceTimersByTimeAsync(40);
    await p;
    expect(done).toBe(true);
  });

  it("waits while a seek is still in flight", async () => {
    const v: FakeVideo = { readyState: 4, seeking: true, error: null };
    let done = false;
    const p = waitForFrameData(asVideo(v), 1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    v.seeking = false;
    await vi.advanceTimersByTimeAsync(40);
    await p;
    expect(done).toBe(true);
  });

  it("rejects capture_failed on a media error", async () => {
    const v: FakeVideo = { readyState: 1, seeking: false, error: null };
    const p = waitForFrameData(asVideo(v), 1000);
    const assertion = expect(p).rejects.toMatchObject({ kind: "capture_failed" });
    v.error = { code: 3 };
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
  });

  it("rejects capture_failed on timeout", async () => {
    const p = waitForFrameData(asVideo({ readyState: 1, seeking: false, error: null }), 200);
    const assertion = expect(p).rejects.toMatchObject({ kind: "capture_failed" });
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
  });
});
