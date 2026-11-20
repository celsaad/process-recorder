// POST /api/upload: raw video body → temp file → Gemini Files API → poll ACTIVE (D4).
// Always application/x-ndjson. See IMPLEMENTATION.md, "HTTP behaviour".
import { AppError, serialize } from "@/lib/errors";
import { MAX_BYTES, isAcceptedType } from "@/lib/limits";
import { formatBytes } from "@/lib/timestamp";
import type { UploadEvent } from "@/lib/types";
import { classifyGeminiError, geminiFor, type GeminiBackend } from "@/server/gemini";
import { NDJSON_HEADERS, ndjsonError, ndjsonLine } from "@/server/http";
import { removeQuietly, tempPathFor, writeBodyToFile } from "@/server/temp-file";

export async function POST(request: Request): Promise<Response> {
  let gemini: GeminiBackend;
  try {
    gemini = geminiFor(request);
  } catch (e) {
    return ndjsonError(classifyGeminiError(e), 500);
  }

  const mimeType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!isAcceptedType(mimeType)) return ndjsonError(new AppError("unsupported_type"), 415);

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) {
    return ndjsonError(new AppError("too_large", formatBytes(length)), 413);
  }
  const body = request.body;
  if (!body) return ndjsonError(new AppError("undecodable"), 400);

  // Aborted when the client disconnects (request.signal) or stops reading (cancel()).
  const abort = new AbortController();
  const onClientAbort = () => abort.abort(request.signal.reason);
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: UploadEvent) => {
        if (!closed) controller.enqueue(encoder.encode(ndjsonLine(event)));
      };
      const path = tempPathFor(mimeType);
      try {
        send({ type: "stage", stage: "received" });
        await writeBodyToFile(body, path, MAX_BYTES, abort.signal);
        send({ type: "stage", stage: "sending_to_gemini" });
        const file = await gemini.uploadAndWait(path, mimeType, abort.signal, (stage) =>
          send({ type: "stage", stage }),
        );
        send({ type: "ready", fileName: file.fileName, mimeType: file.mimeType });
      } catch (e) {
        const error = abort.signal.aborted ? new AppError("cancelled") : classifyGeminiError(e);
        send({ type: "error", error: serialize(error) });
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
        await removeQuietly(path);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel(reason) {
      closed = true;
      abort.abort(reason);
    },
  });

  return new Response(stream, { status: 200, headers: NDJSON_HEADERS });
}
