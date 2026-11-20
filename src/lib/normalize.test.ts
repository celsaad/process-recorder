import { describe, expect, it } from "vitest";
import { cleanText, normalizeSteps } from "./normalize";
import { GeminiResponseSchema, type GeminiResponse, type GeminiStep } from "./schema";
import realResponse from "@/server/__fixtures__/gemini-response.json";

const step = (timestamp: string, action = timestamp, box_2d: number[] = []): GeminiStep => ({
  action,
  description: `do ${action}`,
  expectedResult: `done ${action}`,
  timestamp,
  box_2d,
});

const response = (steps: GeminiStep[]): GeminiResponse => ({
  isScreenRecording: true,
  rejectionReason: "",
  processTitle: "Test",
  steps,
});

const times = (steps: GeminiStep[]) => normalizeSteps(response(steps)).map((s) => s.timestampSec);

describe("normalizeSteps", () => {
  it("returns [] for no steps", () => {
    expect(normalizeSteps(response([]))).toEqual([]);
  });

  it("sorts out-of-order steps by timestamp", () => {
    const out = normalizeSteps(response([step("00:30", "c"), step("00:05", "a"), step("00:12", "b")]));
    expect(out.map((s) => s.action)).toEqual(["a", "b", "c"]);
    expect(out.map((s) => s.timestampSec)).toEqual([5, 12, 30]);
  });

  it("nudges a duplicate by +0.5 s and keeps the model's order", () => {
    const out = normalizeSteps(response([step("00:10", "first"), step("00:10", "second")]));
    expect(out.map((s) => [s.action, s.timestampSec])).toEqual([
      ["first", 10],
      ["second", 10.5],
    ]);
  });

  it("nudges three-way duplicates into distinct, increasing times", () => {
    expect(times([step("00:10"), step("00:10"), step("00:10")])).toEqual([10, 10.5, 11]);
  });

  it("keeps nudging when a nudge collides with the next real timestamp", () => {
    expect(times([step("00:10"), step("00:10"), step("00:10"), step("00:11")])).toEqual([
      10, 10.5, 11, 11.5,
    ]);
  });

  it("drops steps with unparseable timestamps", () => {
    const out = normalizeSteps(response([step("abc", "bad"), step("00:04", "good"), step("", "empty")]));
    expect(out.map((s) => s.action)).toEqual(["good"]);
  });

  it("converts box_2d [ymin, xmin, ymax, xmax] to a normalized rect", () => {
    const [s] = normalizeSteps(response([step("00:01", "a", [100, 200, 300, 600])]));
    expect(s.box).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
  });

  it("gives box null for [] or a degenerate box", () => {
    const out = normalizeSteps(response([step("00:01", "a", []), step("00:02", "b", [5, 5, 5, 5])]));
    expect(out.map((s) => s.box)).toEqual([null, null]);
  });

  it("maps fields to RawStep and trims whitespace", () => {
    const [s] = normalizeSteps(
      response([
        {
          action: " Click 'New' ",
          description: "desc\n",
          expectedResult: " result",
          timestamp: "1:05",
          box_2d: [],
        },
      ]),
    );
    expect(s).toEqual({
      action: "Click 'New'",
      description: "desc",
      expectedResult: "result",
      timestampSec: 65,
      box: null,
    });
  });

  it("normalizes the real recorded Gemini response", () => {
    const out = normalizeSteps(GeminiResponseSchema.parse(realResponse));
    expect(out.length).toBe(realResponse.steps.length);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].timestampSec).toBeGreaterThan(out[i - 1].timestampSec);
    }
  });
});

describe("cleanText (control characters from the model)", () => {
  it("strips NULs and other C0 controls seen in real Gemini output, keeping tabs and newlines", () => {
    expect(cleanText("Click 'MM - Requisi\u0000\u0000o'")).toBe("Click 'MM - Requisio'");
    expect(cleanText("a\u0007b\u001Fc\u007Fd")).toBe("abcd");
    expect(cleanText("line 1\nline 2\tx")).toBe("line 1\nline 2\tx");
    expect(cleanText("  Requisição  ")).toBe("Requisição");
  });
});

describe("normalizeSteps cleans model text", () => {
  it("removes control characters from action, description and expected result", () => {
    const [s] = normalizeSteps(response([step("0:05", "Click 'Requisi\u0000\u0000o'")]));
    expect(s.action).toBe("Click 'Requisio'");
    expect(s.description).toBe("do Click 'Requisio'");
    expect(s.expectedResult).toBe("done Click 'Requisio'");
  });
});
