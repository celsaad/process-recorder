import { describe, expect, it } from "vitest";
import { AppError, ERROR_COPY, ERROR_KINDS, serialize, toAppError } from "./errors";
import type { ErrorKind } from "./types";

describe("toAppError", () => {
  it("maps AbortError to cancelled", () => {
    expect(toAppError(new DOMException("The operation was aborted.", "AbortError")).kind).toBe("cancelled");
  });

  it("maps a fetch TypeError to network", () => {
    expect(toAppError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(toAppError(new TypeError("fetch failed")).kind).toBe("network");
  });

  it("maps QuotaExceededError to storage_full", () => {
    expect(toAppError(new DOMException("Quota exceeded", "QuotaExceededError")).kind).toBe("storage_full");
  });

  it("maps unknown errors to gemini_failed", () => {
    expect(toAppError(new Error("boom")).kind).toBe("gemini_failed");
    expect(toAppError("weird").kind).toBe("gemini_failed");
    expect(toAppError(new TypeError("x is not a function")).kind).toBe("gemini_failed");
  });

  it("passes AppErrors through and revives serialized errors", () => {
    const e = new AppError("too_large", "640 MB");
    expect(toAppError(e)).toBe(e);
    const revived = toAppError({ kind: "rate_limited" });
    expect(revived).toBeInstanceOf(AppError);
    expect(revived.kind).toBe("rate_limited");
  });
});

describe("serialize", () => {
  it("keeps kind and detail", () => {
    expect(serialize(new AppError("too_long", "12:40"))).toEqual({ kind: "too_long", detail: "12:40" });
  });
  it("omits a missing detail", () => {
    expect(serialize(new AppError("network"))).toEqual({ kind: "network" });
  });
});

describe("ERROR_COPY", () => {
  // Fails to compile if a kind is added to ErrorKind but not to ERROR_KINDS.
  const _exhaustive: Record<ErrorKind, true> = Object.fromEntries(ERROR_KINDS.map((k) => [k, true])) as Record<
    ErrorKind,
    true
  >;
  void _exhaustive;

  it("covers every ErrorKind exactly", () => {
    expect(Object.keys(ERROR_COPY).sort()).toEqual([...ERROR_KINDS].sort());
  });

  it.each(ERROR_KINDS)("%s has a title, a body, an action and a retryFrom", (kind) => {
    const copy = ERROR_COPY[kind];
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.body().length).toBeGreaterThan(0);
    expect(copy.body("DETAIL").length).toBeGreaterThan(0);
    expect(["choose_file", "retry", "export", "none"]).toContain(copy.primaryAction);
    expect([null, "upload", "analyze", "capture"]).toContain(copy.retryFrom);
    // Retry needs somewhere to resume from.
    if (copy.primaryAction === "retry") expect(copy.retryFrom).not.toBeNull();
  });

  it("fills in detail (D10 copy)", () => {
    expect(ERROR_COPY.unsupported_type.body(".pdf")).toBe(
      "That's a .pdf. Upload an MP4, MOV or WebM screen recording.",
    );
    expect(ERROR_COPY.too_long.body("12:40")).toBe("This video is 12:40. Recordings must be 10 minutes or less.");
    expect(ERROR_COPY.too_large.body("640 MB")).toBe("This file is 640 MB. The limit is 500 MB.");
    expect(ERROR_COPY.not_screen_recording.body("It shows a person talking")).toContain("It shows a person talking.");
  });

  it("resumes where D10 says", () => {
    expect(ERROR_COPY.rate_limited.retryFrom).toBe("analyze");
    expect(ERROR_COPY.bad_model_output.retryFrom).toBe("analyze");
    expect(ERROR_COPY.file_expired.retryFrom).toBe("upload");
    expect(ERROR_COPY.cancelled.retryFrom).toBeNull();
  });
});
