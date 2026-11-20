// Lane B. Client for /api/upload (NDJSON stream) and /api/analyze. Throws AppError.
import type { RawStep, UploadStage } from "./types";

export type UploadOptions = { signal?: AbortSignal; onStage?: (stage: UploadStage) => void };
export type UploadResult = { fileName: string; mimeType: string };
export type AnalyzeResult = { processTitle: string; steps: RawStep[] };

const notImplemented = (): never => {
  throw new Error("not implemented");
};

/** Accepts a Blob so `file_expired` can re-upload the stored video. */
export async function uploadVideo(file: Blob, options: UploadOptions = {}): Promise<UploadResult> {
  void file;
  void options;
  return notImplemented();
}

export async function analyzeVideo(
  fileName: string,
  options: { signal?: AbortSignal } = {},
): Promise<AnalyzeResult> {
  void fileName;
  void options;
  return notImplemented();
}

/** Best effort: never throws. */
export async function deleteGeminiFile(fileName: string): Promise<void> {
  void fileName;
  return notImplemented();
}
