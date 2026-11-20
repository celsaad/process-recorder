// Lane C. Browser-side probing and frame capture (D3, D6, D16).
import { AppError } from "./errors";
import { encodeFrame, scaleToFit } from "./image";
import { ACCEPTED_EXTENSIONS, MAX_BYTES, MAX_DURATION_SEC, isAcceptedType } from "./limits";
import { formatBytes, formatTimestamp } from "./timestamp";
import type { VideoInfo } from "./types";

export type FrameGrabber = {
  /** Sequential; a per-seek timeout rejects with AppError("capture_failed"). */
  capture: (sec: number, options?: { signal?: AbortSignal }) => Promise<Blob>;
  dispose: () => void;
};

const METADATA_TIMEOUT_MS = 8000;
/** QuickTime reports a real 10:00 recording as ~600.03 s; don't reject it as too long. */
const DURATION_TOLERANCE_SEC = 0.5;
const SEEK_TIMEOUT_MS = 5000;
/** If `requestVideoFrameCallback` never fires after a seek, draw anyway after this long. */
const FRAME_CALLBACK_FALLBACK_MS = 500;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : "";
}

function isAcceptedExtension(ext: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
}

/** Type and ≤ MAX_BYTES. Throws AppError with display-ready `detail` (".pdf", "640 MB"). */
export function validateFile(file: File): void {
  const ext = extensionOf(file.name);
  // Some OSes report an empty MIME type for .mov, so a known extension is accepted too.
  const typeOk = file.type ? isAcceptedType(file.type) : isAcceptedExtension(ext);
  if (!typeOk) throw new AppError("unsupported_type", ext || file.type || undefined);
  if (file.size > MAX_BYTES) throw new AppError("too_large", formatBytes(file.size));
}

/**
 * Resolves on the first of `events`. Rejects with `onTimeout` on timeout, `onError` (default
 * `onTimeout`) on an `error` event, and `cancelled` as soon as any of `signals` aborts.
 * Always removes its listeners, so nothing is left to reject later.
 */
function waitFor(
  target: EventTarget,
  events: string[],
  {
    timeoutMs,
    onTimeout,
    errorEvent = "error",
    onError,
    signals = [],
  }: {
    timeoutMs: number;
    onTimeout: () => Error;
    errorEvent?: string;
    onError?: () => Error;
    signals?: (AbortSignal | undefined)[];
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const live = signals.filter((s): s is AbortSignal => s !== undefined);
    if (live.some((s) => s.aborted)) return reject(new AppError("cancelled"));
    const cleanup = () => {
      clearTimeout(timer);
      for (const e of events) target.removeEventListener(e, onEvent);
      target.removeEventListener(errorEvent, onFail);
      for (const s of live) s.removeEventListener("abort", onAbort);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onFail = () => {
      cleanup();
      reject(onError ? onError() : onTimeout());
    };
    const onAbort = () => {
      cleanup();
      reject(new AppError("cancelled"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(onTimeout());
    }, timeoutMs);
    for (const e of events) target.addEventListener(e, onEvent);
    target.addEventListener(errorEvent, onFail);
    for (const s of live) s.addEventListener("abort", onAbort);
  });
}

type DurationSource = EventTarget & { duration: number; currentTime: number };

/**
 * Reads the duration of a loaded video. MediaRecorder WebM files report `Infinity`; seeking to a
 * huge time forces the browser to compute the real length (D3).
 */
export async function resolveDuration(video: DurationSource, timeoutMs = METADATA_TIMEOUT_MS): Promise<number> {
  if (video.duration === Infinity) {
    const resolved = new Promise<void>((resolve, reject) => {
      const check = () => {
        if (Number.isFinite(video.duration)) {
          cleanup();
          resolve();
        }
      };
      const fail = () => {
        cleanup();
        reject(new AppError("undecodable"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("durationchange", check);
        video.removeEventListener("timeupdate", check);
        video.removeEventListener("error", fail);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new AppError("undecodable"));
      }, timeoutMs);
      video.addEventListener("durationchange", check);
      video.addEventListener("timeupdate", check);
      video.addEventListener("error", fail);
      video.currentTime = 1e101;
    });
    await resolved;
    video.currentTime = 0;
  }
  const d = video.duration;
  if (!Number.isFinite(d) || d <= 0) throw new AppError("undecodable");
  return d;
}

function createVideoElement(url: string, preload: "metadata" | "auto"): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = preload;
  video.src = url;
  return video;
}

function releaseVideo(video: HTMLVideoElement, url: string) {
  video.removeAttribute("src");
  video.load();
  URL.revokeObjectURL(url);
}

/** Loads the file to read duration/size. `> MAX_DURATION_SEC` → too_long; no metadata → undecodable. */
export async function probeVideo(file: File, options: { timeoutMs?: number } = {}): Promise<VideoInfo> {
  const timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS;
  const url = URL.createObjectURL(file);
  const video = createVideoElement(url, "metadata");
  try {
    // Chrome can't tell us up front whether it decodes a .mov; loading it is the only test (D3).
    await waitFor(video, ["loadedmetadata"], {
      timeoutMs,
      onTimeout: () => new AppError("undecodable"),
    });
    if (!video.videoWidth || !video.videoHeight) throw new AppError("undecodable");
    const durationSec = await resolveDuration(video, timeoutMs);
    if (durationSec > MAX_DURATION_SEC + DURATION_TOLERANCE_SEC) throw new AppError("too_long", formatTimestamp(durationSec));
    return {
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type || MIME_BY_EXTENSION[extensionOf(file.name)] || "video/mp4",
      durationSec,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    releaseVideo(video, url);
  }
}

/** Waits for an in-flight seek, if any. */
async function settle(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (!video.seeking) return;
  await waitFor(video, ["seeked"], { timeoutMs, onTimeout: () => new AppError("capture_failed") });
}

function drawFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight || video.readyState < 2) throw new AppError("capture_failed");
  const { width, height } = scaleToFit(videoWidth, videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AppError("capture_failed");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, 0, 0, width, height);
  return canvas;
}

/** Captures the frame currently shown by a (visible) video element. */
export async function captureFromVideo(video: HTMLVideoElement): Promise<Blob> {
  await settle(video, SEEK_TIMEOUT_MS);
  // Right after a seek lands, Chrome can still report HAVE_METADATA (readyState 1)
  // until the frame is decoded. Wait for the data instead of failing the capture.
  await waitForFrameData(video, SEEK_TIMEOUT_MS);
  return encodeFrame(drawFrame(video));
}

/** Resolves once the element has decoded data for the current position (readyState >= 2)
 *  and isn't seeking. Polls the condition: `loadeddata` fires only once per load, and
 *  readiness events after a seek aren't reliable across engines. Rejects `capture_failed`
 *  on a media error or timeout. */
export function waitForFrameData(video: HTMLVideoElement, timeoutMs: number, pollMs = 30): Promise<void> {
  const ready = () => video.readyState >= 2 && !video.seeking;
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (video.error) {
        clearInterval(timer);
        reject(new AppError("capture_failed"));
      } else if (ready()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new AppError("capture_failed"));
      }
    }, pollMs);
  });
}

/**
 * After a seek, waits until the new frame is actually presented (so the canvas isn't one frame stale).
 * `cancel` (and the fallback timeout) drop the callback, so one that never fired can't linger.
 */
function nextPresentedFrame(video: HTMLVideoElement): { done: Promise<void>; cancel: () => void } {
  if (typeof video.requestVideoFrameCallback !== "function") return { done: Promise.resolve(), cancel: () => {} };
  let cancel = () => {};
  const done = new Promise<void>((resolve) => {
    const handle = video.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve();
    });
    const drop = () => {
      clearTimeout(timer);
      video.cancelVideoFrameCallback?.(handle);
      resolve();
    };
    const timer = setTimeout(drop, FRAME_CALLBACK_FALLBACK_MS);
    cancel = drop;
  });
  return { done, cancel };
}

const seekWait = (video: HTMLVideoElement, signals: (AbortSignal | undefined)[]) =>
  waitFor(video, ["seeked"], {
    timeoutMs: SEEK_TIMEOUT_MS,
    onTimeout: () => new AppError("capture_failed"),
    onError: () => new AppError("capture_failed"),
    signals,
  });

async function seekTo(video: HTMLVideoElement, sec: number, signals: (AbortSignal | undefined)[]): Promise<void> {
  // A capture aborted mid-seek leaves the element seeking. Let that seek land first, or its
  // `seeked` would satisfy the wait below and the canvas would get the old frame.
  if (video.seeking) await seekWait(video, signals);
  // Setting currentTime to its current value never fires `seeked`, so skip the wait (D3).
  if (Math.abs(video.currentTime - sec) < 0.001 && video.readyState >= 2) return;
  const seeked = seekWait(video, signals);
  const frame = nextPresentedFrame(video);
  video.currentTime = sec;
  try {
    await seeked;
  } catch (e) {
    frame.cancel();
    throw e;
  }
  await frame.done;
}

/** Rejects with `cancelled` as soon as `signal` aborts, without cancelling `promise` itself. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AppError("cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AppError("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createFrameGrabber(blob: Blob): FrameGrabber {
  const url = URL.createObjectURL(blob);
  const video = createVideoElement(url, "auto");
  const lifetime = new AbortController();
  let ready: Promise<void> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  // The load is shared by every capture, so it ends only with the grabber. Each capture races it
  // against its own signal, so an aborted capture doesn't wait out the 8 s load timeout.
  const load = (signal: AbortSignal | undefined) => {
    if (!ready) {
      ready =
        video.readyState >= 2
          ? Promise.resolve()
          : waitFor(video, ["loadeddata"], {
              timeoutMs: METADATA_TIMEOUT_MS,
              onTimeout: () => new AppError("undecodable"),
              onError: () => new AppError("undecodable"),
              signals: [lifetime.signal],
            });
      // If every capture stopped waiting, a later rejection must not go unhandled.
      ready.catch(() => undefined);
    }
    return untilAborted(ready, signal);
  };

  const run = async (sec: number, signal?: AbortSignal): Promise<Blob> => {
    const signals = [signal, lifetime.signal];
    const check = () => {
      if (signals.some((s) => s?.aborted)) throw new AppError("cancelled");
    };
    check();
    await load(signal);
    check();
    await seekTo(video, Math.max(0, sec), signals);
    check();
    return encodeFrame(drawFrame(video));
  };

  return {
    capture(sec, options = {}) {
      // Sequential: parallel seeks on one element race. A failed capture must not break the queue.
      const result = queue.then(() => run(sec, options.signal));
      queue = result.catch(() => undefined);
      return result;
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      // Pending waits reject with `cancelled` straight away, before the element is torn down.
      lifetime.abort();
      releaseVideo(video, url);
    },
  };
}
