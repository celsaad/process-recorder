// Lane B. Client for /api/upload (NDJSON stream) and /api/analyze. Throws AppError.
// The client never branches on HTTP status: it always parses the body as the contract shape.
import { AppError, toAppError } from "./errors";
import { AnalyzeResponseSchema, UploadEventSchema } from "./schema";
import type { RawStep, UploadEvent, UploadStage } from "./types";

export type UploadOptions = { signal?: AbortSignal; onStage?: (stage: UploadStage) => void };
export type UploadResult = { fileName: string; mimeType: string };
export type AnalyzeResult = { processTitle: string; steps: RawStep[] };

function parseLine(line: string): UploadEvent {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (e) {
    throw new AppError("bad_model_output", undefined, { cause: e });
  }
  const parsed = UploadEventSchema.safeParse(json);
  if (!parsed.success) throw new AppError("bad_model_output", undefined, { cause: parsed.error });
  return parsed.data;
}

/** Accepts a Blob so `file_expired` can re-upload the stored video. */
export async function uploadVideo(file: Blob, options: UploadOptions = {}): Promise<UploadResult> {
  const { signal, onStage } = options;
  try {
    const headers: Record<string, string> = {};
    if (file.type) headers["Content-Type"] = file.type;
    const res = await fetch("/api/upload", { method: "POST", body: file, headers, signal });
    if (!res.body) throw new AppError("bad_model_output");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let ready: UploadResult | null = null;

    const handle = (line: string): void => {
      if (!line.trim()) return;
      const event = parseLine(line);
      if (event.type === "stage") onStage?.(event.stage);
      else if (event.type === "ready") ready = { fileName: event.fileName, mimeType: event.mimeType };
      else throw new AppError(event.error.kind, event.error.detail);
    };

    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        // Browsers fail a dropped body stream with a bare TypeError("network error").
        if (e instanceof TypeError) throw new AppError("network", undefined, { cause: e });
        throw e;
      }
      const { done, value } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line);
      if (ready) {
        void reader.cancel().catch(() => {});
        return ready;
      }
    }
    buffer += decoder.decode();
    handle(buffer);
    // Stream ended without `ready` or `error`: the connection was cut.
    if (!ready) throw new AppError("network");
    return ready;
  } catch (e) {
    throw toAppError(e);
  }
}

export async function analyzeVideo(
  fileName: string,
  options: { signal?: AbortSignal } = {},
): Promise<AnalyzeResult> {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName }),
      signal: options.signal,
    });
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      if (options.signal?.aborted) throw e;
      throw new AppError("bad_model_output", undefined, { cause: e });
    }
    const parsed = AnalyzeResponseSchema.safeParse(json);
    if (!parsed.success) throw new AppError("bad_model_output", undefined, { cause: parsed.error });
    if (!parsed.data.ok) throw new AppError(parsed.data.error.kind, parsed.data.error.detail);
    return { processTitle: parsed.data.processTitle, steps: parsed.data.steps };
  } catch (e) {
    throw toAppError(e);
  }
}

/** Best effort: never throws. */
export async function deleteGeminiFile(fileName: string): Promise<void> {
  try {
    await fetch(`/api/file?name=${encodeURIComponent(fileName)}`, { method: "DELETE" });
  } catch {
    // ignored by contract
  }
}
