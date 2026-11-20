import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { removeQuietly, tempPathFor, writeBodyToFile } from "./temp-file";

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      c.close();
    },
  });

const paths: string[] = [];
const path = (mime = "video/mp4") => {
  const p = tempPathFor(mime);
  paths.push(p);
  return p;
};
afterEach(async () => {
  await Promise.all(paths.splice(0).map(removeQuietly));
});

describe("writeBodyToFile", () => {
  it("streams chunks to disk and returns the byte count", async () => {
    const p = path();
    expect(p).toMatch(/\.mp4$/);
    expect(await writeBodyToFile(streamOf("abc", "def"), p, 100)).toBe(6);
    expect(readFileSync(p, "utf8")).toBe("abcdef");
  });

  it("throws too_large past the limit even without a Content-Length", async () => {
    await expect(writeBodyToFile(streamOf("12345", "67890"), path(), 8)).rejects.toMatchObject({
      kind: "too_large",
    });
  });

  it("removeQuietly deletes and ignores missing files", async () => {
    const p = path("video/quicktime");
    expect(p).toMatch(/\.mov$/);
    await writeBodyToFile(streamOf("x"), p, 10);
    await removeQuietly(p);
    expect(existsSync(p)).toBe(false);
    await expect(removeQuietly(p)).resolves.toBeUndefined();
  });
});
