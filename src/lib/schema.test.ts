import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AnalyzeResponseSchema, GeminiResponseSchema, UploadEventSchema } from "./schema";

const validStep = {
  action: "Click 'New Order'",
  description: "Click the New Order button.",
  expectedResult: "A blank order form opens.",
  timestamp: "00:04",
  box_2d: [90, 810, 150, 940],
};
const valid = {
  isScreenRecording: true,
  rejectionReason: "",
  processTitle: "Create a purchase order",
  steps: [validStep],
};

describe("GeminiResponseSchema", () => {
  it("accepts a valid response", () => {
    expect(GeminiResponseSchema.parse(valid)).toEqual(valid);
  });

  it("accepts an empty box", () => {
    const r = GeminiResponseSchema.parse({ ...valid, steps: [{ ...validStep, box_2d: [] }] });
    expect(r.steps[0].box_2d).toEqual([]);
  });

  it.each(["processTitle", "isScreenRecording", "rejectionReason", "steps"] as const)(
    "fails when %s is missing",
    (key) => {
      const copy: Record<string, unknown> = { ...valid };
      delete copy[key];
      expect(GeminiResponseSchema.safeParse(copy).success).toBe(false);
    },
  );

  it("fails when a step field is missing", () => {
    const { timestamp: _omit, ...step } = validStep;
    void _omit;
    expect(GeminiResponseSchema.safeParse({ ...valid, steps: [step] }).success).toBe(false);
  });

  it("turns a box_2d of length 3 into [] without failing the response", () => {
    const r = GeminiResponseSchema.safeParse({ ...valid, steps: [{ ...validStep, box_2d: [1, 2, 3] }] });
    expect(r.success).toBe(true);
    expect(r.data?.steps[0].box_2d).toEqual([]);
  });

  it("turns an out-of-range box into []", () => {
    const r = GeminiResponseSchema.parse({ ...valid, steps: [{ ...validStep, box_2d: [0, 0, 1200, 10] }] });
    expect(r.steps[0].box_2d).toEqual([]);
  });

  it("strips extra fields", () => {
    const r = GeminiResponseSchema.parse({
      ...valid,
      confidence: 0.9,
      steps: [{ ...validStep, notes: "extra" }],
    });
    expect(r).not.toHaveProperty("confidence");
    expect(r.steps[0]).not.toHaveProperty("notes");
  });
});

describe("UploadEventSchema", () => {
  it.each([
    { type: "stage", stage: "received" },
    { type: "stage", stage: "sending_to_gemini" },
    { type: "stage", stage: "gemini_processing" },
    { type: "ready", fileName: "files/abc123", mimeType: "video/mp4" },
    { type: "error", error: { kind: "too_large", detail: "640 MB" } },
    { type: "error", error: { kind: "network" } },
  ])("parses %j", (event) => {
    expect(UploadEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    { type: "progress", percent: 50 },
    { type: "stage", stage: "uploading" },
    { type: "error", error: { kind: "nope" } },
    {},
  ])("rejects %j", (event) => {
    expect(UploadEventSchema.safeParse(event).success).toBe(false);
  });
});

describe("contract fixtures (src/fixtures/http)", () => {
  const dir = join(process.cwd(), "src/fixtures/http");
  const read = (f: string) => readFileSync(join(dir, f), "utf8");

  it.each(["upload-happy.ndjson", "upload-too-large.ndjson"])("%s: every line is an UploadEvent", (f) => {
    const lines = read(f).trim().split("\n");
    for (const line of lines) expect(UploadEventSchema.safeParse(JSON.parse(line)).success).toBe(true);
  });

  it.each([
    "analyze-ok.json",
    "analyze-no-steps.json",
    "analyze-rate-limited.json",
    "analyze-not-screen-recording.json",
  ])("%s is an AnalyzeResponse", (f) => {
    expect(AnalyzeResponseSchema.safeParse(JSON.parse(read(f))).success).toBe(true);
  });
});
