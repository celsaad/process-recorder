import { ApiError } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import recorded from "./__fixtures__/gemini-response.json";

const sdk = vi.hoisted(() => ({
  generateContent: vi.fn(),
  filesGet: vi.fn(),
  filesUpload: vi.fn(),
  filesDelete: vi.fn(),
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class GoogleGenAI {
    models = { generateContent: sdk.generateContent };
    files = { get: sdk.filesGet, upload: sdk.filesUpload, delete: sdk.filesDelete };
  }
  return { ...actual, GoogleGenAI };
});

const { classifyGeminiError, FinishReasonError, generateSteps, geminiFor, getClient, uploadAndWait } =
  await import("./gemini");

const ok = (text: string, finishReason = "STOP") => ({ text, candidates: [{ finishReason }] });
const ACTIVE = { name: "files/abc", uri: "https://x/files/abc", mimeType: "video/mp4", state: "ACTIVE" };

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_FAKE", "");
  Object.values(sdk).forEach((f) => f.mockReset());
  sdk.filesDelete.mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("classifyGeminiError", () => {
  const kind = (e: unknown) => classifyGeminiError(e).kind;

  it("maps HTTP statuses", () => {
    expect(kind(new ApiError({ status: 429, message: "quota" }))).toBe("rate_limited");
    expect(kind(new ApiError({ status: 404, message: "nope" }))).toBe("file_expired");
    expect(kind(new ApiError({ status: 500, message: "boom" }))).toBe("gemini_failed");
    expect(kind(new ApiError({ status: 503, message: "overloaded" }))).toBe("gemini_failed");
  });

  it("treats the Files API's 403 'may not exist' as an expired file", () => {
    const e = new ApiError({
      status: 403,
      message: "You do not have permission to access the File x or it may not exist.",
    });
    expect(kind(e)).toBe("file_expired");
  });

  it.each([
    ["MAX_TOKENS", "bad_model_output"],
    ["SAFETY", "gemini_blocked"],
    ["BLOCKLIST", "gemini_blocked"],
    ["PROHIBITED_CONTENT", "gemini_blocked"],
    ["SPII", "gemini_blocked"],
    ["RECITATION", "gemini_blocked"],
    ["IMAGE_SAFETY", "gemini_blocked"],
    ["IMAGE_PROHIBITED_CONTENT", "gemini_blocked"],
    ["IMAGE_RECITATION", "gemini_blocked"],
    ["MODEL_ARMOR", "gemini_blocked"],
    ["ESCALATION", "gemini_blocked"],
    ["PUP_LIMITED_DISABLED", "gemini_blocked"],
    ["LANGUAGE", "gemini_blocked"],
    ["EMPTY", "gemini_blocked"],
    // Not a refusal: retryable.
    ["OTHER", "gemini_failed"],
    ["FINISH_REASON_UNSPECIFIED", "gemini_failed"],
    ["MALFORMED_RESPONSE", "gemini_failed"],
    ["SOME_FUTURE_REASON", "gemini_failed"],
  ])("maps finishReason %s to %s", (reason, expected) => {
    expect(kind(new FinishReasonError(reason))).toBe(expected);
  });

  it("maps invalid JSON and schema failures to bad_model_output", () => {
    expect(kind(new SyntaxError("Unexpected token"))).toBe("bad_model_output");
    expect(kind(z.object({ a: z.string() }).safeParse({}).error)).toBe("bad_model_output");
  });

  it("maps a missing or invalid key to missing_api_key", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => getClient()).toThrow(AppError);
    try {
      getClient();
    } catch (e) {
      expect(kind(e)).toBe("missing_api_key");
    }
    expect(kind(new ApiError({ status: 400, message: "API key not valid. Please pass a valid API key." }))).toBe(
      "missing_api_key",
    );
  });

  it("maps aborts to cancelled, passes AppErrors through, defaults to gemini_failed", () => {
    expect(kind(new DOMException("aborted", "AbortError"))).toBe("cancelled");
    expect(kind(new AppError("rate_limited"))).toBe("rate_limited");
    expect(kind(new TypeError("fetch failed"))).toBe("gemini_failed");
    expect(kind("weird")).toBe("gemini_failed");
  });
});

describe("generateSteps", () => {
  it("returns the zod-parsed response with low thinking and the schema", async () => {
    sdk.filesGet.mockResolvedValue(ACTIVE);
    sdk.generateContent.mockResolvedValue(ok(JSON.stringify(recorded)));
    const res = await generateSteps("files/abc");
    expect(res.steps).toHaveLength(recorded.steps.length);
    const call = sdk.generateContent.mock.calls[0][0];
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.responseSchema).toBeDefined();
    expect(call.config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(call.contents[0].parts[0].fileData.fileUri).toBe(ACTIVE.uri);
  });

  it("uses a zero thinking budget on gemini-2.x", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
    sdk.filesGet.mockResolvedValue(ACTIVE);
    sdk.generateContent.mockResolvedValue(ok(JSON.stringify(recorded)));
    await generateSteps("files/abc");
    const call = sdk.generateContent.mock.calls[0][0];
    expect(call.model).toBe("gemini-2.5-flash");
    expect(call.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("retries once with the validation error fed back", async () => {
    sdk.filesGet.mockResolvedValue(ACTIVE);
    sdk.generateContent
      .mockResolvedValueOnce(ok(JSON.stringify({ ...recorded, processTitle: undefined })))
      .mockResolvedValueOnce(ok(JSON.stringify(recorded)));
    const res = await generateSteps("files/abc");
    expect(res.processTitle).toBe(recorded.processTitle);
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
    const retry = sdk.generateContent.mock.calls[1][0].contents;
    expect(retry.at(-1).parts[0].text).toMatch(/processTitle/);
  });

  it("gives bad_model_output when the retry is invalid too", async () => {
    sdk.filesGet.mockResolvedValue(ACTIVE);
    sdk.generateContent.mockResolvedValue(ok("{not json"));
    await expect(generateSteps("files/abc")).rejects.toMatchObject({ kind: "bad_model_output" });
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
  });

  it("retries a MAX_TOKENS truncation, then gives bad_model_output", async () => {
    sdk.filesGet.mockResolvedValue(ACTIVE);
    sdk.generateContent.mockResolvedValue(ok('{"steps": [', "MAX_TOKENS"));
    await expect(generateSteps("files/abc")).rejects.toMatchObject({ kind: "bad_model_output" });
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
  });

  it("gives a retryable gemini_failed, without an output retry, for finishReason OTHER", async () => {
    sdk.filesGet.mockResolvedValue(ACTIVE);
    sdk.generateContent.mockResolvedValue(ok("", "OTHER"));
    await expect(generateSteps("files/abc")).rejects.toMatchObject({ kind: "gemini_failed" });
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not retry SAFETY or an empty response (gemini_blocked)", async () => {
    sdk.filesGet.mockResolvedValue(ACTIVE);
    sdk.generateContent.mockResolvedValueOnce(ok("", "SAFETY"));
    await expect(generateSteps("files/abc")).rejects.toMatchObject({ kind: "gemini_blocked" });
    sdk.generateContent.mockResolvedValueOnce({ text: "", candidates: [] });
    await expect(generateSteps("files/abc")).rejects.toMatchObject({ kind: "gemini_blocked" });
    sdk.generateContent.mockResolvedValueOnce({ promptFeedback: { blockReason: "SAFETY" } });
    await expect(generateSteps("files/abc")).rejects.toMatchObject({ kind: "gemini_blocked" });
    expect(sdk.generateContent).toHaveBeenCalledTimes(3);
  });

  it("gives file_expired when files.get 404s, rate_limited on 429", async () => {
    sdk.filesGet.mockRejectedValueOnce(new ApiError({ status: 404, message: "not found" }));
    await expect(generateSteps("files/abc")).rejects.toMatchObject({ kind: "file_expired" });
    sdk.filesGet.mockResolvedValue(ACTIVE);
    sdk.generateContent.mockRejectedValueOnce(new ApiError({ status: 429, message: "quota" }));
    await expect(generateSteps("files/abc")).rejects.toMatchObject({ kind: "rate_limited" });
  });
});

describe("uploadAndWait", () => {
  it("uploads, reports gemini_processing, polls until ACTIVE", async () => {
    vi.useFakeTimers();
    sdk.filesUpload.mockResolvedValue({ ...ACTIVE, state: "PROCESSING" });
    sdk.filesGet.mockResolvedValueOnce({ ...ACTIVE, state: "PROCESSING" }).mockResolvedValueOnce(ACTIVE);
    const onStage = vi.fn();
    const done = uploadAndWait("/tmp/x.mp4", "video/mp4", undefined, onStage);
    await vi.runAllTimersAsync();
    await expect(done).resolves.toEqual({ fileName: "files/abc", mimeType: "video/mp4" });
    expect(onStage).toHaveBeenCalledWith("gemini_processing");
    expect(sdk.filesGet).toHaveBeenCalledTimes(2);
    expect(sdk.filesUpload.mock.calls[0][0]).toMatchObject({ file: "/tmp/x.mp4", config: { mimeType: "video/mp4" } });
  });

  it("gives gemini_failed and deletes the file when processing FAILED", async () => {
    sdk.filesUpload.mockResolvedValue({ ...ACTIVE, state: "FAILED" });
    await expect(uploadAndWait("/tmp/x.mp4", "video/mp4")).rejects.toMatchObject({ kind: "gemini_failed" });
    expect(sdk.filesDelete).toHaveBeenCalledWith({ name: "files/abc" });
  });

  it("times out after 2 minutes of PROCESSING", async () => {
    vi.useFakeTimers();
    sdk.filesUpload.mockResolvedValue({ ...ACTIVE, state: "PROCESSING" });
    sdk.filesGet.mockResolvedValue({ ...ACTIVE, state: "PROCESSING" });
    const done = uploadAndWait("/tmp/x.mp4", "video/mp4");
    const assertion = expect(done).rejects.toMatchObject({ kind: "gemini_failed" });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 5000);
    await assertion;
  });

  it("stops polling when aborted", async () => {
    sdk.filesUpload.mockResolvedValue({ ...ACTIVE, state: "PROCESSING" });
    sdk.filesGet.mockResolvedValue({ ...ACTIVE, state: "PROCESSING" });
    const controller = new AbortController();
    const done = uploadAndWait("/tmp/x.mp4", "video/mp4", controller.signal, () => controller.abort());
    await expect(done).rejects.toBeDefined();
    expect(classifyGeminiError(await done.catch((e) => e)).kind).toBe("cancelled");
    expect(sdk.filesGet).not.toHaveBeenCalled();
  });
});

describe("geminiFor", () => {
  it("throws missing_api_key for the real backend without a key", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => geminiFor(new Request("http://x/"))).toThrow(/missing_api_key/);
  });

  it("uses the fake (no key needed) when GEMINI_FAKE=1", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_FAKE", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {}); // the once-per-process fake-mode warning
    const req = new Request("http://x/", { headers: { cookie: "fake-scenario=no_steps" } });
    const res = await geminiFor(req).generateSteps("files/abc");
    expect(res.steps).toEqual([]);
    expect(sdk.generateContent).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
