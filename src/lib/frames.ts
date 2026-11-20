// Lane C. Browser-side probing and frame capture (D3, D6, D16).
import type { VideoInfo } from "./types";

export type FrameGrabber = {
  /** Sequential; a per-seek timeout rejects with AppError("capture_failed"). */
  capture: (sec: number, options?: { signal?: AbortSignal }) => Promise<Blob>;
  dispose: () => void;
};

const notImplemented = (): never => {
  throw new Error("not implemented");
};

/** Type and ≤ MAX_BYTES. Throws AppError with display-ready `detail` (".pdf", "640 MB"). */
export function validateFile(file: File): void {
  void file;
  notImplemented();
}

/** Loads the file to read duration/size. `> MAX_DURATION_SEC` → too_long; no metadata → undecodable. */
export async function probeVideo(file: File, options: { timeoutMs?: number } = {}): Promise<VideoInfo> {
  void file;
  void options;
  return notImplemented();
}

export function createFrameGrabber(blob: Blob): FrameGrabber {
  void blob;
  return notImplemented();
}

/** Captures the frame currently shown by a (visible) video element. */
export async function captureFromVideo(video: HTMLVideoElement): Promise<Blob> {
  void video;
  return notImplemented();
}
