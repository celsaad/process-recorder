// Route / contract tests (layer 3): call each handler with a Request, Gemini mocked,
// and check statuses and bodies against the shapes in src/fixtures/http/.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { AnalyzeResponseSchema, UploadEventSchema, type GeminiResponse } from "@/lib/schema";
import type { GeminiBackend } from "@/server/gemini";
import recorded from "@/server/__fixtures__/gemini-response.json";

const backend = vi.hoisted(() => ({
  uploadAndWait: vi.fn(),
  generateSteps: vi.fn(),
  deleteFile: vi.fn(),
}));
const geminiFor = vi.hoisted(() => vi.fn());

vi.mock("@/server/gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/gemini")>()),
  geminiFor,
}));

const { POST: upload } = await import("./upload/route");
const { POST: analyze } = await import("./analyze/route");
const { DELETE: deleteFile } = await import("./file/route");

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "src/fixtures/http", name), "utf8");
const ndjson = (text: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => UploadEventSchema.parse(JSON.parse(line)));
const fixtureEvents = (name: string) => ndjson(fixture(name));

const uploadRequest = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/upload", {
    method: "POST",
    body,
    headers: { "content-type": "video/mp4", ...headers },
  });
const analyzeRequest = (body: unknown) =>
  new Request("http://localhost/api/analyze", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  Object.values(backend).forEach((f) => f.mockReset());
  geminiFor.mockReset().mockReturnValue(backend satisfies GeminiBackend);
});

describe("POST /api/upload", () => {
  it("streams the happy-path events in the fixture's shape, and deletes the temp file", async () => {
    let tempPath = "";
    backend.uploadAndWait.mockImplementation(async (path: string, mimeType: string, _s, onStage) => {
      tempPath = path;
      expect(readFileSync(path, "utf8")).toBe("fake video bytes");
      onStage("gemini_processing");
      return { fileName: "files/k3j9x0q2b7mf", mimeType };
    });
    const res = await upload(uploadRequest("fake video bytes"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect(ndjson(await res.text())).toEqual(fixtureEvents("upload-happy.ndjson"));
    expect(tempPath).not.toBe("");
    expect(existsSync(tempPath)).toBe(false);
  });

  it("ends with an error event, and deletes the temp file, when Gemini fails", async () => {
    let tempPath = "";
    backend.uploadAndWait.mockImplementation(async (path: string) => {
      tempPath = path;
      throw new AppError("gemini_failed");
    });
    const res = await upload(uploadRequest("bytes"));
    expect(res.status).toBe(200);
    const events = ndjson(await res.text());
    expect(events.at(-1)).toEqual({ type: "error", error: { kind: "gemini_failed" } });
    expect(existsSync(tempPath)).toBe(false);
  });

  it("rejects an oversized Content-Length with 413 and a single NDJSON error line", async () => {
    const res = await upload(uploadRequest("x", { "content-length": String(640 * 1024 ** 2) }));
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect(ndjson(await res.text())).toEqual(fixtureEvents("upload-too-large.ndjson"));
    expect(backend.uploadAndWait).not.toHaveBeenCalled();
  });

  it("rejects a non-video type with 415", async () => {
    const res = await upload(uploadRequest("x", { "content-type": "application/pdf" }));
    expect(res.status).toBe(415);
    expect(ndjson(await res.text())).toEqual([{ type: "error", error: { kind: "unsupported_type" } }]);
  });

  it("accepts video/quicktime and passes the type through", async () => {
    backend.uploadAndWait.mockResolvedValue({ fileName: "files/mov1", mimeType: "video/quicktime" });
    const res = await upload(uploadRequest("x", { "content-type": "video/quicktime" }));
    expect(ndjson(await res.text()).at(-1)).toEqual({
      type: "ready",
      fileName: "files/mov1",
      mimeType: "video/quicktime",
    });
    expect(backend.uploadAndWait.mock.calls[0][1]).toBe("video/quicktime");
  });

  it("rejects a missing API key with 500 and a single NDJSON error line", async () => {
    geminiFor.mockImplementation(() => {
      throw new AppError("missing_api_key");
    });
    const res = await upload(uploadRequest("x"));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect(ndjson(await res.text())).toEqual([{ type: "error", error: { kind: "missing_api_key" } }]);
  });

  it("reports cancelled when the client aborts mid-upload", async () => {
    const controller = new AbortController();
    backend.uploadAndWait.mockImplementation(
      (_p, _m, signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          controller.abort();
        }),
    );
    const req = new Request("http://localhost/api/upload", {
      method: "POST",
      body: "x",
      headers: { "content-type": "video/mp4" },
      signal: controller.signal,
    });
    const res = await upload(req);
    expect(ndjson(await res.text()).at(-1)).toEqual({ type: "error", error: { kind: "cancelled" } });
  });
});

describe("POST /api/analyze", () => {
  const response = (patch: Partial<GeminiResponse> = {}): GeminiResponse => ({
    isScreenRecording: true,
    rejectionReason: "",
    processTitle: "Create a purchase order",
    steps: recorded.steps.slice(0, 4),
    ...patch,
  });

  it("returns ok with normalized steps (analyze-ok.json shape)", async () => {
    backend.generateSteps.mockResolvedValue(response());
    const res = await analyze(analyzeRequest({ fileName: "files/k3j9x0q2b7mf" }));
    expect(res.status).toBe(200);
    const body = AnalyzeResponseSchema.parse(await res.json());
    const expected = AnalyzeResponseSchema.parse(JSON.parse(fixture("analyze-ok.json")));
    expect(Object.keys(body).sort()).toEqual(Object.keys(expected).sort());
    if (!body.ok || !expected.ok) throw new Error("expected ok");
    expect(body.processTitle).toBe("Create a purchase order");
    expect(body.steps).toHaveLength(4);
    expect(Object.keys(body.steps[0]).sort()).toEqual(Object.keys(expected.steps[0]).sort());
    expect(backend.generateSteps).toHaveBeenCalledWith("files/k3j9x0q2b7mf", expect.any(AbortSignal));
  });

  it("returns ok with [] for no steps (analyze-no-steps.json)", async () => {
    backend.generateSteps.mockResolvedValue(response({ processTitle: "", steps: [] }));
    const res = await analyze(analyzeRequest({ fileName: "files/abc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(fixture("analyze-no-steps.json")));
  });

  it("returns 422 not_screen_recording with the model's reason", async () => {
    const reason = "The video shows a person talking to the camera, not a computer screen.";
    backend.generateSteps.mockResolvedValue(
      response({ isScreenRecording: false, rejectionReason: reason, steps: [] }),
    );
    const res = await analyze(analyzeRequest({ fileName: "files/abc" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(JSON.parse(fixture("analyze-not-screen-recording.json")));
  });

  it.each([
    ["rate_limited", 429],
    ["file_expired", 404],
    ["bad_model_output", 422],
    ["gemini_blocked", 422],
    ["gemini_failed", 500],
    ["missing_api_key", 500],
  ] as const)("maps %s to %i", async (kind, status) => {
    backend.generateSteps.mockRejectedValue(new AppError(kind));
    const res = await analyze(analyzeRequest({ fileName: "files/abc" }));
    expect(res.status).toBe(status);
    const body = AnalyzeResponseSchema.parse(await res.json());
    expect(body).toEqual({ ok: false, error: { kind } });
  });

  it("matches analyze-rate-limited.json exactly", async () => {
    backend.generateSteps.mockRejectedValue(new AppError("rate_limited"));
    const res = await analyze(analyzeRequest({ fileName: "files/abc" }));
    expect(await res.json()).toEqual(JSON.parse(fixture("analyze-rate-limited.json")));
  });

  it("returns missing_api_key (500) when the backend can't be built", async () => {
    geminiFor.mockImplementation(() => {
      throw new AppError("missing_api_key");
    });
    const res = await analyze(analyzeRequest({ fileName: "files/abc" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: { kind: "missing_api_key" } });
  });

  it.each([
    { fileName: "https://evil.example/video" },
    { fileName: "files/../secrets" },
    { fileName: "files/ABC" },
    { fileName: 42 },
    {},
    "not json",
  ])("rejects a bad fileName %j with 400", async (body) => {
    const res = await analyze(analyzeRequest(body));
    expect(res.status).toBe(400);
    AnalyzeResponseSchema.parse(await res.json());
    expect(backend.generateSteps).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/file", () => {
  const del = (name: string) =>
    deleteFile(new Request(`http://localhost/api/file?name=${encodeURIComponent(name)}`, { method: "DELETE" }));

  it("deletes and returns 204", async () => {
    backend.deleteFile.mockResolvedValue(undefined);
    const res = await del("files/abc-123");
    expect(res.status).toBe(204);
    expect(backend.deleteFile).toHaveBeenCalledWith("files/abc-123");
  });

  it("still returns 204 when Gemini fails (best effort)", async () => {
    backend.deleteFile.mockRejectedValue(new Error("gone"));
    expect((await del("files/abc")).status).toBe(204);
  });

  it("rejects a bad name with 400", async () => {
    expect((await del("../etc/passwd")).status).toBe(400);
    expect(backend.deleteFile).not.toHaveBeenCalled();
  });
});
