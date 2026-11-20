import { describe, expect, it } from "vitest";
import { inferVideoType, isAcceptedType, isLongVideo, MAX_BYTES, MAX_DURATION_SEC, SOFT_DURATION_SEC, withVideoType } from "./limits";

describe("limits", () => {
  it("matches D16", () => {
    expect(SOFT_DURATION_SEC).toBe(180);
    expect(MAX_DURATION_SEC).toBe(600);
    expect(MAX_BYTES).toBe(500 * 1024 ** 2);
  });
  it("isLongVideo is strictly over 3:00", () => {
    expect(isLongVideo(180)).toBe(false);
    expect(isLongVideo(180.1)).toBe(true);
    expect(isLongVideo(326)).toBe(true);
  });
  it("accepts the three video types", () => {
    expect(isAcceptedType("video/mp4")).toBe(true);
    expect(isAcceptedType("video/quicktime")).toBe(true);
    expect(isAcceptedType("video/webm")).toBe(true);
    expect(isAcceptedType("application/pdf")).toBe(false);
  });
});

describe("inferVideoType / withVideoType (empty File.type, e.g. .mov on Windows)", () => {
  it("maps accepted extensions case-insensitively", () => {
    expect(inferVideoType("demo.MOV")).toBe("video/quicktime");
    expect(inferVideoType("a.b.mp4")).toBe("video/mp4");
    expect(inferVideoType("clip.webm")).toBe("video/webm");
    expect(inferVideoType("notes.pdf")).toBeNull();
    expect(inferVideoType("noextension")).toBeNull();
  });

  it("fills in a missing type and keeps name, size and content", async () => {
    const original = new File(["abc"], "Recording.mov", { type: "", lastModified: 123 });
    const typed = withVideoType(original);
    expect(typed.type).toBe("video/quicktime");
    expect(typed.name).toBe("Recording.mov");
    expect(typed.size).toBe(3);
    expect(typed.lastModified).toBe(123);
    expect(await typed.text()).toBe("abc");
  });

  it("leaves files that already have a type, or an unknown extension, untouched", () => {
    const mp4 = new File(["x"], "a.mp4", { type: "video/mp4" });
    expect(withVideoType(mp4)).toBe(mp4);
    const pdf = new File(["x"], "a.pdf", { type: "" });
    expect(withVideoType(pdf)).toBe(pdf);
  });
});
