import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeVideo, deleteGeminiFile, uploadVideo } from "./api-client";
import { AppError } from "./errors";
import type { UploadStage } from "./types";

const fixture = (name: string) => readFileSync(join(process.cwd(), "src/fixtures/http", name), "utf8");

const enc = new TextEncoder();

/** NDJSON response whose body is delivered in the given chunks. */
function streamResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "application/x-ndjson" } });
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const video = new Blob(["abc"], { type: "video/mp4" });

async function rejection(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

afterEach(() => vi.unstubAllGlobals());

describe("uploadVideo", () => {
  it("parses the happy fixture and reports stages in order", async () => {
    const spy = mockFetch(async () => streamResponse([fixture("upload-happy.ndjson")]));
    const stages: UploadStage[] = [];
    const result = await uploadVideo(video, { onStage: (s) => stages.push(s) });
    expect(result).toEqual({ fileName: "files/k3j9x0q2b7mf", mimeType: "video/mp4" });
    expect(stages).toEqual(["received", "sending_to_gemini", "gemini_processing"]);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/upload");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(video);
  });

  it("tolerates lines split mid-line across chunks, byte by byte", async () => {
    const text = fixture("upload-happy.ndjson");
    mockFetch(async () => streamResponse(text.split("")));
    const stages: UploadStage[] = [];
    const result = await uploadVideo(video, { onStage: (s) => stages.push(s) });
    expect(result.fileName).toBe("files/k3j9x0q2b7mf");
    expect(stages).toHaveLength(3);
  });

  it("handles several events in one chunk and a final line without newline", async () => {
    mockFetch(async () =>
      streamResponse([
        '{"type":"stage","stage":"received"}\n{"type":"stage","stage":"sending_to_gemini"}\n{"type":"ready",',
        '"fileName":"files/abc","mimeType":"video/webm"}',
      ]),
    );
    const stages: UploadStage[] = [];
    const result = await uploadVideo(video, { onStage: (s) => stages.push(s) });
    expect(result).toEqual({ fileName: "files/abc", mimeType: "video/webm" });
    expect(stages).toEqual(["received", "sending_to_gemini"]);
  });

  it("splits a multi-byte character across chunks inside a parsed line", async () => {
    const bytes = enc.encode(
      '{"type":"stage","stage":"received"}\n{"type":"ready","fileName":"files/café","mimeType":"video/mp4"}\n',
    );
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    });
    mockFetch(async () => new Response(body));
    await expect(uploadVideo(video)).resolves.toEqual({ fileName: "files/café", mimeType: "video/mp4" });
  });

  it("a truncated trailing fragment after a clean close → network", async () => {
    mockFetch(async () =>
      streamResponse(['{"type":"stage","stage":"received"}\n{"type":"ready","fileNa']),
    );
    expect((await rejection(uploadVideo(video))).kind).toBe("network");
  });

  it("a response with no body → network", async () => {
    mockFetch(async () => new Response(null));
    expect((await rejection(uploadVideo(video))).kind).toBe("network");
  });

  it.each([
    ["missing_api_key", 500, '{"type":"error","error":{"kind":"missing_api_key"}}\n', undefined],
    ["unsupported_type", 415, '{"type":"error","error":{"kind":"unsupported_type","detail":".pdf"}}\n', ".pdf"],
  ] as const)("pre-stream %s rejection parses on a %i", async (kind, status, line, detail) => {
    mockFetch(async () => streamResponse([line], status));
    const e = await rejection(uploadVideo(video));
    expect(e.kind).toBe(kind);
    expect(e.detail).toBe(detail);
  });

  it("throws the AppError from an error event, even on a non-200 response", async () => {
    mockFetch(async () => streamResponse([fixture("upload-too-large.ndjson")], 413));
    const e = await rejection(uploadVideo(video));
    expect(e.kind).toBe("too_large");
    expect(e.detail).toBe("640 MB");
  });

  it("maps an error event after stages", async () => {
    mockFetch(async () =>
      streamResponse([
        '{"type":"stage","stage":"received"}\n{"type":"error","error":{"kind":"gemini_failed"}}\n',
      ]),
    );
    expect((await rejection(uploadVideo(video))).kind).toBe("gemini_failed");
  });

  it("malformed JSON → bad_model_output", async () => {
    mockFetch(async () => streamResponse(['{"type":"stage",\n']));
    expect((await rejection(uploadVideo(video))).kind).toBe("bad_model_output");
  });

  it("an unknown event type → bad_model_output", async () => {
    mockFetch(async () => streamResponse(['{"type":"progress","pct":50}\n']));
    expect((await rejection(uploadVideo(video))).kind).toBe("bad_model_output");
  });

  it("a stream that ends without ready or error → network", async () => {
    mockFetch(async () => streamResponse(['{"type":"stage","stage":"received"}\n']));
    expect((await rejection(uploadVideo(video))).kind).toBe("network");
  });

  it("fetch rejecting → network", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await rejection(uploadVideo(video))).kind).toBe("network");
  });

  it("a stream that errors mid-read with a network TypeError → network", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('{"type":"stage","stage":"received"}\n'));
        c.error(new TypeError("network error"));
      },
    });
    mockFetch(async () => new Response(body));
    expect((await rejection(uploadVideo(video))).kind).toBe("network");
  });

  it("abort before the response → cancelled", async () => {
    mockFetch(async (_url, init) => {
      init?.signal?.throwIfAborted();
      return streamResponse([]);
    });
    const ac = new AbortController();
    ac.abort();
    expect((await rejection(uploadVideo(video, { signal: ac.signal }))).kind).toBe("cancelled");
  });

  it("abort mid-stream → cancelled", async () => {
    const ac = new AbortController();
    mockFetch(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode('{"type":"stage","stage":"received"}\n'));
          init?.signal?.addEventListener("abort", () => c.error(init.signal?.reason));
        },
      });
      return new Response(body);
    });
    const p = uploadVideo(video, { signal: ac.signal, onStage: () => ac.abort() });
    expect((await rejection(p)).kind).toBe("cancelled");
  });
});

describe("analyzeVideo", () => {
  const json = (body: unknown, status = 200) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("parses the ok fixture", async () => {
    const spy = mockFetch(async () => json(fixture("analyze-ok.json")));
    const r = await analyzeVideo("files/abc");
    expect(r.processTitle).toBe("Create a purchase order");
    expect(r.steps.length).toBeGreaterThan(0);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/analyze");
    expect(JSON.parse(init?.body as string)).toEqual({ fileName: "files/abc" });
  });

  it("returns an empty steps array without error", async () => {
    mockFetch(async () => json(fixture("analyze-no-steps.json")));
    const r = await analyzeVideo("files/abc");
    expect(r.steps).toEqual([]);
  });

  it("rate_limited fixture on a 429", async () => {
    mockFetch(async () => json(fixture("analyze-rate-limited.json"), 429));
    expect((await rejection(analyzeVideo("files/abc"))).kind).toBe("rate_limited");
  });

  it("not_screen_recording fixture keeps the detail, on a 422", async () => {
    mockFetch(async () => json(fixture("analyze-not-screen-recording.json"), 422));
    const e = await rejection(analyzeVideo("files/abc"));
    expect(e.kind).toBe("not_screen_recording");
    expect(e.detail).toBeTruthy();
  });

  it("does not branch on status: ok body on a 500 still succeeds", async () => {
    mockFetch(async () => json(fixture("analyze-ok.json"), 500));
    await expect(analyzeVideo("files/abc")).resolves.toMatchObject({ processTitle: "Create a purchase order" });
  });

  it("file_expired on a 404", async () => {
    mockFetch(async () => json({ ok: false, error: { kind: "file_expired" } }, 404));
    expect((await rejection(analyzeVideo("files/abc"))).kind).toBe("file_expired");
  });

  it("body stream dropped mid-read → network, not bad_model_output", async () => {
    mockFetch(async () => {
      const res = json("{}");
      vi.spyOn(res, "json").mockRejectedValue(new TypeError("network error"));
      return res;
    });
    expect((await rejection(analyzeVideo("files/abc"))).kind).toBe("network");
  });

  it("non-JSON body → bad_model_output", async () => {
    mockFetch(async () => json("<html>oops</html>", 500));
    expect((await rejection(analyzeVideo("files/abc"))).kind).toBe("bad_model_output");
  });

  it("wrong shape → bad_model_output", async () => {
    mockFetch(async () => json({ ok: true, steps: "nope" }));
    expect((await rejection(analyzeVideo("files/abc"))).kind).toBe("bad_model_output");
  });

  it("fetch rejects → network", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await rejection(analyzeVideo("files/abc"))).kind).toBe("network");
  });

  it("abort → cancelled", async () => {
    mockFetch(async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    expect((await rejection(analyzeVideo("files/abc"))).kind).toBe("cancelled");
  });

  it("abort while reading the body → cancelled", async () => {
    const ac = new AbortController();
    mockFetch(async () => {
      const res = json("{}");
      vi.spyOn(res, "json").mockImplementation(async () => {
        ac.abort();
        throw new DOMException("Aborted", "AbortError");
      });
      return res;
    });
    expect((await rejection(analyzeVideo("files/abc", { signal: ac.signal }))).kind).toBe("cancelled");
  });
});

describe("deleteGeminiFile", () => {
  it("sends DELETE with the encoded name", async () => {
    const spy = mockFetch(async () => new Response(null, { status: 204 }));
    await deleteGeminiFile("files/abc-1");
    expect(spy.mock.calls[0][0]).toBe("/api/file?name=files%2Fabc-1");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("never throws", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(deleteGeminiFile("files/abc")).resolves.toBeUndefined();
  });
});
