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

/** Resolves on the first of `events`; rejects with `onTimeout`/`onError` otherwise. */
function waitFor(
  target: EventTarget,
  events: string[],
  { timeoutMs, onTimeout, errorEvent = "error", onError }: { timeoutMs: number; onTimeout: () => Error; errorEvent?: string; onError?: () => Error },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      for (const e of events) target.removeEventListener(e, onEvent);
      target.removeEventListener(errorEvent, onFail);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onFail = () => {
      cleanup();
      reject(onError ? onError() : onTimeout());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(onTimeout());
    }, timeoutMs);
    for (const e of events) target.addEventListener(e, onEvent);
    target.addEventListener(errorEvent, onFail);
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
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("durationchange", check);
        video.removeEventListener("timeupdate", check);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new AppError("undecodable"));
      }, timeoutMs);
      video.addEventListener("durationchange", check);
      video.addEventListener("timeupdate", check);
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
    if (durationSec > MAX_DURATION_SEC) throw new AppError("too_long", formatTimestamp(durationSec));
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
  return encodeFrame(drawFrame(video));
}

/** After a seek, waits until the new frame is actually presented (so the canvas isn't one frame stale). */
function nextPresentedFrame(video: HTMLVideoElement): Promise<void> {
  if (typeof video.requestVideoFrameCallback !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FRAME_CALLBACK_FALLBACK_MS);
    video.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function seekTo(video: HTMLVideoElement, sec: number, signal?: AbortSignal): Promise<void> {
  // Setting currentTime to its current value never fires `seeked`, so skip the wait (D3).
  if (!video.seeking && Math.abs(video.currentTime - sec) < 0.001 && video.readyState >= 2) return;
  const seeked = waitFor(video, ["seeked"], {
    timeoutMs: SEEK_TIMEOUT_MS,
    onTimeout: () => new AppError("capture_failed"),
    onError: () => new AppError("capture_failed"),
  });
  const frame = nextPresentedFrame(video);
  video.currentTime = sec;
  signal?.throwIfAborted();
  await seeked;
  await frame;
}

export function createFrameGrabber(blob: Blob): FrameGrabber {
  const url = URL.createObjectURL(blob);
  const video = createVideoElement(url, "auto");
  let ready: Promise<void> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;

  const load = () =>
    (ready ??=
      video.readyState >= 2
        ? Promise.resolve()
        : waitFor(video, ["loadeddata"], {
            timeoutMs: METADATA_TIMEOUT_MS,
            onTimeout: () => new AppError("undecodable"),
            onError: () => new AppError("undecodable"),
          }));

  const run = async (sec: number, signal?: AbortSignal): Promise<Blob> => {
    if (disposed) throw new AppError("cancelled");
    if (signal?.aborted) throw new AppError("cancelled");
    await load();
    if (disposed || signal?.aborted) throw new AppError("cancelled");
    await seekTo(video, Math.max(0, sec), signal);
    if (disposed || signal?.aborted) throw new AppError("cancelled");
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
      if (disposed) return;
      disposed = true;
      releaseVideo(video, url);
    },
  };
}
