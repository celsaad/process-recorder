// Lane A. Small helpers shared by the API routes (IMPLEMENTATION.md, "HTTP behaviour").
import { serialize, type AppError } from "@/lib/errors";
import type { AnalyzeResponse, ErrorKind, UploadEvent } from "@/lib/types";

/** D4: the client can only refer to files by name, never supply a URI. */
export const FILE_NAME_PATTERN = /^files\/[a-z0-9-]+$/;

export function isValidFileName(value: unknown): value is string {
  return typeof value === "string" && FILE_NAME_PATTERN.test(value);
}

/** processTitle when the model returns an empty one (matches analyze-no-steps.json). */
export const UNTITLED_PROCESS = "Untitled process";

/** Statuses are for correctness and logs; the client always parses the body. */
export function analyzeStatus(kind: ErrorKind): number {
  switch (kind) {
    case "file_expired":
      return 404;
    case "rate_limited":
      return 429;
    case "bad_model_output":
    case "gemini_blocked":
    case "not_screen_recording":
      return 422;
    case "cancelled":
      return 499; // client closed the request; nobody reads this
    default:
      return 500;
  }
}

export function analyzeJson(body: AnalyzeResponse, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function analyzeError(error: AppError, status = analyzeStatus(error.kind)): Response {
  return analyzeJson({ ok: false, error: serialize(error) }, status);
}

export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
} as const;

export const ndjsonLine = (event: UploadEvent) => `${JSON.stringify(event)}\n`;

/** A rejection before streaming: one `error` line with a meaningful status. */
export function ndjsonError(error: AppError, status: number): Response {
  return new Response(ndjsonLine({ type: "error", error: serialize(error) }), {
    status,
    headers: NDJSON_HEADERS,
  });
}
