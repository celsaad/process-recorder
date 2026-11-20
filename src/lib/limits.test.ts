import { describe, expect, it } from "vitest";
import { isAcceptedType, isLongVideo, MAX_BYTES, MAX_DURATION_SEC, SOFT_DURATION_SEC } from "./limits";

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
