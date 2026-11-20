import type { ErrorKind, RetryFrom, SerializedAppError } from "./types";

/** Every ErrorKind, in D10 order. Used by zod schemas and exhaustive tests. */
export const ERROR_KINDS = [
  "missing_api_key",
  "unsupported_type",
  "too_long",
  "too_large",
  "undecodable",
  "network",
  "rate_limited",
  "gemini_failed",
  "gemini_blocked",
  "bad_model_output",
  "file_expired",
  "not_screen_recording",
  "capture_failed",
  "storage_full",
  "cancelled",
] as const satisfies readonly ErrorKind[];

export function isErrorKind(value: unknown): value is ErrorKind {
  return typeof value === "string" && (ERROR_KINDS as readonly string[]).includes(value);
}

export class AppError extends Error {
  kind: ErrorKind;
  detail?: string;

  constructor(kind: ErrorKind, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${kind}: ${detail}` : kind, options);
    this.name = "AppError";
    this.kind = kind;
    if (detail !== undefined) this.detail = detail;
  }
}

const NETWORK_MESSAGE = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i;

function errorName(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "name" in e && typeof e.name === "string") {
    return e.name;
  }
  return undefined;
}

/** AbortError → cancelled, fetch TypeError → network, QuotaExceededError → storage_full,
 *  a SerializedAppError-shaped object → that kind, anything else → gemini_failed. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;

  const name = errorName(e);
  if (name === "AbortError") return new AppError("cancelled", undefined, { cause: e });
  if (name === "QuotaExceededError") return new AppError("storage_full", undefined, { cause: e });
  if (e instanceof TypeError && NETWORK_MESSAGE.test(e.message)) {
    return new AppError("network", undefined, { cause: e });
  }

  if (typeof e === "object" && e !== null && "kind" in e && isErrorKind(e.kind)) {
    const detail = "detail" in e && typeof e.detail === "string" ? e.detail : undefined;
    return new AppError(e.kind, detail, { cause: e });
  }

  return new AppError("gemini_failed", undefined, { cause: e });
}

export function serialize(e: AppError): SerializedAppError {
  return e.detail === undefined ? { kind: e.kind } : { kind: e.kind, detail: e.detail };
}

/**
 * User-facing copy for every error (D10).
 *
 * `retryFrom` is the default resume point for the kind. When the job machine
 * recorded where the failure happened (`job.retryFrom`), that wins: e.g. a
 * `network` error during analysis retries from "analyze", not "upload".
 */
export const ERROR_COPY: Record<
  ErrorKind,
  {
    title: string;
    body: (detail?: string) => string;
    /** Optional "what to do" line under the body (Errors / StatesUpload boards). */
    hint?: string;
    primaryAction: "choose_file" | "retry" | "export" | "none";
    retryFrom: RetryFrom | null;
  }
> = {
  missing_api_key: {
    title: "The Gemini API key is missing",
    body: () => "GEMINI_API_KEY isn't set. Add it to .env.local and restart.",
    hint: "The file goes in the project root, next to package.json.",
    primaryAction: "none",
    retryFrom: null,
  },
  unsupported_type: {
    title: "Unsupported file type",
    body: (detail) =>
      `${detail ? `That's a ${detail}.` : "That file type isn't supported."} Upload an MP4, MOV or WebM screen recording.`,
    primaryAction: "choose_file",
    retryFrom: null,
  },
  too_long: {
    title: "This recording is too long",
    body: (detail) =>
      `${detail ? `This video is ${detail}.` : "This video is too long."} Recordings must be 10 minutes or less.`,
    hint: "Trim it to the part that shows the process, or record a shorter take.",
    primaryAction: "choose_file",
    retryFrom: null,
  },
  too_large: {
    title: "File is too large",
    body: (detail) =>
      `${detail ? `This file is ${detail}.` : "This file is too large."} The limit is 500 MB.`,
    primaryAction: "choose_file",
    retryFrom: null,
  },
  undecodable: {
    title: "This video can't be played here",
    body: () => "Your browser couldn't decode it, so screenshots can't be captured from it.",
    hint: "Re-export it as an H.264 MP4, then upload that file. Nothing was sent to Gemini.",
    primaryAction: "choose_file",
    retryFrom: null,
  },
  network: {
    title: "Connection lost",
    body: () => "Connection lost.",
    primaryAction: "retry",
    retryFrom: "upload",
  },
  rate_limited: {
    title: "Gemini is busy right now",
    body: () => "Gemini is rate-limiting requests. Wait a moment and try again.",
    primaryAction: "retry",
    retryFrom: "analyze",
  },
  gemini_failed: {
    title: "Processing failed",
    body: () => "Gemini couldn't process the video.",
    primaryAction: "retry",
    retryFrom: "upload",
  },
  gemini_blocked: {
    title: "Analysis declined",
    body: () => "Gemini declined to analyze this video.",
    primaryAction: "choose_file",
    retryFrom: null,
  },
  bad_model_output: {
    title: "Incomplete response",
    body: () => "The AI's response came back incomplete.",
    primaryAction: "retry",
    retryFrom: "analyze",
  },
  file_expired: {
    title: "Upload expired",
    body: () => "The uploaded video expired. We'll upload it again from your browser.",
    primaryAction: "retry",
    retryFrom: "upload",
  },
  not_screen_recording: {
    title: "This doesn't look like a screen recording",
    body: (detail) =>
      `${detail ? `${detail.trim().replace(/\.?$/, ".")} ` : ""}Upload a screen recording of someone clicking through a process in an app or website, with the screen clearly visible.`,
    primaryAction: "choose_file",
    retryFrom: null,
  },
  capture_failed: {
    title: "Screenshot failed",
    body: () => "We couldn't capture a screenshot for this step. Pick a frame instead.",
    primaryAction: "retry",
    retryFrom: "capture",
  },
  storage_full: {
    title: "Browser storage is full",
    body: () => "Changes won't survive a refresh. Export now.",
    primaryAction: "export",
    retryFrom: null,
  },
  cancelled: {
    title: "Cancelled",
    body: () => "Cancelled.",
    primaryAction: "none",
    retryFrom: null,
  },
};
