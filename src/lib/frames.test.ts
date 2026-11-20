import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { resolveDuration, validateFile } from "./frames";

function file(name: string, type: string, size = 1024): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function catchError(fn: () => void): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected validateFile to throw");
}

describe("validateFile", () => {
  it("accepts mp4, quicktime and webm", () => {
    expect(() => validateFile(file("a.mp4", "video/mp4"))).not.toThrow();
    expect(() => validateFile(file("a.mov", "video/quicktime"))).not.toThrow();
    expect(() => validateFile(file("a.webm", "video/webm"))).not.toThrow();
  });

  it("accepts an empty MIME type when the extension is known (.mov on some OSes)", () => {
    expect(() => validateFile(file("a.MOV", ""))).not.toThrow();
  });

  it("rejects other types with the extension as detail", () => {
    const e = catchError(() => validateFile(file("notes.pdf", "application/pdf")));
    expect(e).toBeInstanceOf(AppError);
    expect(e.kind).toBe("unsupported_type");
    expect(e.detail).toBe(".pdf");
  });

  it("rejects an unknown empty-typed file", () => {
    expect(catchError(() => validateFile(file("README", ""))).kind).toBe("unsupported_type");
  });

  it("rejects files over 500 MB with a display-ready size", () => {
    const e = catchError(() => validateFile(file("big.mp4", "video/mp4", 640 * 1024 ** 2)));
    expect(e.kind).toBe("too_large");
    expect(e.detail).toBe("640 MB");
  });

  it("accepts exactly 500 MB", () => {
    expect(() => validateFile(file("edge.mp4", "video/mp4", 500 * 1024 ** 2))).not.toThrow();
  });
});

/** A <video> stand-in: an EventTarget whose duration is fixed until `currentTime` is set. */
class FakeVideo extends EventTarget {
  duration: number;
  private resolvedDuration: number | null;
  private time = 0;
  seeks: number[] = [];

  constructor(duration: number, resolvedDuration: number | null = null) {
    super();
    this.duration = duration;
    this.resolvedDuration = resolvedDuration;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(v: number) {
    this.time = v;
    this.seeks.push(v);
    if (this.resolvedDuration !== null && v > 1e9) {
      this.duration = this.resolvedDuration;
      queueMicrotask(() => this.dispatchEvent(new Event("durationchange")));
    }
  }
}

describe("resolveDuration", () => {
  it("returns a finite duration directly without seeking", async () => {
    const v = new FakeVideo(42.5);
    expect(await resolveDuration(v)).toBe(42.5);
    expect(v.seeks).toEqual([]);
  });

  it("uses the seek-to-huge-time workaround for Infinity, then rewinds", async () => {
    const v = new FakeVideo(Infinity, 125.4);
    expect(await resolveDuration(v)).toBe(125.4);
    expect(v.seeks).toEqual([1e101, 0]);
  });

  it("is undecodable when Infinity never resolves", async () => {
    const v = new FakeVideo(Infinity, null);
    await expect(resolveDuration(v, 20)).rejects.toMatchObject({ kind: "undecodable" });
  });

  it("is undecodable for NaN or zero duration", async () => {
    await expect(resolveDuration(new FakeVideo(NaN))).rejects.toMatchObject({ kind: "undecodable" });
    await expect(resolveDuration(new FakeVideo(0))).rejects.toMatchObject({ kind: "undecodable" });
  });
});
