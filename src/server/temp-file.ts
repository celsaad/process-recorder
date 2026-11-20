// Lane A. Streams a request body to a temp file without buffering it in memory (D4).
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { AppError } from "@/lib/errors";
import { formatBytes } from "@/lib/timestamp";

const EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

export function tempPathFor(mimeType: string): string {
  return join(tmpdir(), `process-recorder-${randomUUID()}${EXTENSIONS[mimeType] ?? ""}`);
}

/**
 * Pipes `body` to `path`. Throws `too_large` (detail = bytes seen so far) once more
 * than `maxBytes` arrive, which also covers bodies without a Content-Length.
 * The caller deletes the file in `finally` (it may be partially written).
 */
export async function writeBodyToFile(
  body: ReadableStream<Uint8Array>,
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<number> {
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) done(new AppError("too_large", formatBytes(bytes)));
      else done(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(body as NodeWebReadableStream<Uint8Array>),
    limit,
    createWriteStream(path),
    { signal },
  );
  return bytes;
}

export async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => {});
}
