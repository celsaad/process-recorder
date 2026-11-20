import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as idb from "idb-keyval";
import { AppError } from "./errors";
import {
  clearAll,
  createDebouncedSaver,
  loadAll,
  loadShot,
  saveProjectNow,
  saveShot,
  saveVideo,
} from "./persistence";
import type { Project, SaveStatus } from "./types";

// ESM namespaces can't be spied on: wrap `set` so tests can count and fail writes.
vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return { ...actual, set: vi.fn(actual.set) };
});
const realSet = (await vi.importActual<typeof import("idb-keyval")>("idb-keyval")).set;
const setMock = vi.mocked(idb.set);

const project = (title = "P"): Project => ({
  id: "p1",
  title,
  video: { name: "a.mp4", sizeBytes: 3, mimeType: "video/mp4", durationSec: 10, width: 1280, height: 720 },
  steps: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
});

beforeEach(async () => {
  setMock.mockReset();
  setMock.mockImplementation(realSet);
  // clearAll waits for the module-level write chain; a test that leaves a write hung would
  // otherwise stall every later test until vitest's timeout. Fail fast with the cause instead.
  let guard: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    clearAll(),
    new Promise<never>((_, reject) => {
      guard = setTimeout(() => reject(new Error("clearAll hung: a previous test left a write in flight")), 2000);
    }),
  ]).finally(() => clearTimeout(guard));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("persistence keys", () => {
  it("loadAll is null on an empty database", async () => {
    expect(await loadAll()).toBeNull();
  });

  it("loadAll is null when only the project (no video) exists", async () => {
    await saveProjectNow(project());
    expect(await loadAll()).toBeNull();
  });

  // Blobs do round-trip under fake-indexeddb on Node, so we store Blobs directly.
  it("round-trips project, video and shots", async () => {
    await saveProjectNow(project("Hello"));
    await saveVideo(new Blob(["video-bytes"], { type: "video/mp4" }));
    await saveShot("s1", new Blob(["shot-bytes"], { type: "image/webp" }));

    const all = await loadAll();
    expect(all?.project.title).toBe("Hello");
    expect(all?.video.size).toBe("video-bytes".length);
    expect(all?.video.type).toBe("video/mp4");
    expect(await all?.video.text()).toBe("video-bytes");

    const shot = await loadShot("s1");
    expect(shot?.type).toBe("image/webp");
    expect(await shot?.text()).toBe("shot-bytes");
    expect(await loadShot("missing")).toBeNull();
  });

  it("uses the D8 split keys", async () => {
    await saveProjectNow(project());
    await saveVideo(new Blob(["v"]));
    await saveShot("abc", new Blob(["s"]));
    expect((await idb.keys()).sort()).toEqual(["project", "shot:abc", "video"]);
  });

  it("clearAll empties everything", async () => {
    await saveProjectNow(project());
    await saveVideo(new Blob(["v"]));
    await saveShot("abc", new Blob(["s"]));
    await clearAll();
    expect(await idb.keys()).toEqual([]);
    expect(await loadAll()).toBeNull();
    expect(await loadShot("abc")).toBeNull();
  });
});

describe("createDebouncedSaver", () => {
  it("writes once for a burst of schedule calls, with the last project", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // fake-indexeddb needs real setImmediate
    const set = setMock;
    const statuses: SaveStatus[] = [];
    const saver = createDebouncedSaver({ onStatus: (s) => statuses.push(s) });

    saver.schedule(project("1"));
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule(project("2"));
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule(project("3"));
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await saver.flush();

    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toMatchObject({ title: "3" });
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("flush writes immediately and cancels the timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // fake-indexeddb needs real setImmediate
    const set = setMock;
    const saver = createDebouncedSaver();
    saver.schedule(project("now"));
    await saver.flush();
    expect(set).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(set).toHaveBeenCalledTimes(1);
    await saveVideo(new Blob(["v"]));
    expect((await loadAll())?.project.title).toBe("now");
  });

  it("flush with nothing pending is a no-op", async () => {
    const set = setMock;
    await createDebouncedSaver().flush();
    expect(set).not.toHaveBeenCalled();
  });

  it("cancel drops the pending write", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // fake-indexeddb needs real setImmediate
    const set = setMock;
    const saver = createDebouncedSaver();
    saver.schedule(project());
    saver.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    await saver.flush();
    expect(set).not.toHaveBeenCalled();
  });

  it("honours a custom ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // fake-indexeddb needs real setImmediate
    const set = setMock;
    const saver = createDebouncedSaver({ ms: 50 });
    saver.schedule(project());
    await vi.advanceTimersByTimeAsync(49);
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("a quota error → onError(storage_full) and status error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // fake-indexeddb needs real setImmediate
    setMock.mockRejectedValue(new DOMException("full", "QuotaExceededError"));
    const errors: AppError[] = [];
    const statuses: SaveStatus[] = [];
    const saver = createDebouncedSaver({
      onError: (e) => errors.push(e),
      onStatus: (s) => statuses.push(s),
    });
    saver.schedule(project());
    await vi.advanceTimersByTimeAsync(500);
    await saver.flush();
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("storage_full");
    expect(statuses).toEqual(["saving", "error"]);
  });

  it("a non-quota write failure is also storage_full, keeping the cause", async () => {
    const cause = new Error("boom");
    setMock.mockRejectedValue(cause);
    const e = await saveShot("s", new Blob(["x"])).catch((x: AppError) => x);
    expect(e).toMatchObject({ kind: "storage_full" });
    expect((e as AppError).cause).toBe(cause);
  });

  it("cancel before the timer fires reports no status at all", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const statuses: SaveStatus[] = [];
    const saver = createDebouncedSaver({ onStatus: (s) => statuses.push(s) });
    saver.schedule(project());
    saver.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses).toEqual([]);
  });

  it("flush while a write is in flight waits for it", async () => {
    let release!: () => void;
    setMock.mockImplementationOnce(
      (key, value) => new Promise<void>((r) => (release = () => void realSet(key, value).then(r))),
    );
    const saver = createDebouncedSaver();
    saver.schedule(project("A"));
    const first = saver.flush();
    let done = false;
    const second = saver.flush().then(() => (done = true)); // nothing pending: waits on the chain
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(done).toBe(true);
    await saveVideo(new Blob(["v"]));
    expect((await loadAll())?.project.title).toBe("A");
  });

  it("cancel + clearAll while A is writing and B is queued leaves no project behind", async () => {
    let release!: () => void;
    setMock.mockImplementationOnce(
      (key, value) => new Promise<void>((r) => (release = () => void realSet(key, value).then(r))),
    );
    const saver = createDebouncedSaver();
    saver.schedule(project("A"));
    const a = saver.flush(); // A in flight (slow)
    await new Promise((r) => setTimeout(r, 10)); // let A reach idb.set
    saver.schedule(project("B"));
    const b = saver.flush(); // B queued behind A
    saver.cancel();
    const cleared = clearAll(); // must wait for A, and B must be skipped
    release();
    await Promise.all([a, b, cleared]);
    expect(await idb.get("project")).toBeUndefined();
    expect(await idb.keys()).toEqual([]);
    expect(setMock).toHaveBeenCalledTimes(1); // B never wrote
  });

  it("a write in flight when cancel runs reports no status or error afterwards", async () => {
    let release!: (fail: boolean) => void;
    // Both writes below (A, then B) wait for `release`; beforeEach restores the real `set`.
    setMock.mockImplementation(
      () => new Promise<void>((resolve, reject) => (release = (fail) => (fail ? reject(new Error("x")) : resolve()))),
    );
    const statuses: SaveStatus[] = [];
    const onError = vi.fn();
    const saver = createDebouncedSaver({ onStatus: (s) => statuses.push(s), onError });

    saver.schedule(project("A"));
    const a = saver.flush();
    await new Promise((r) => setTimeout(r, 10)); // A reaches idb.set
    saver.cancel(); // "Start new" resets the status to idle here
    release(false);
    await a;
    expect(statuses).toEqual(["saving"]); // no late "saved"

    saver.schedule(project("B"));
    const b = saver.flush();
    await new Promise((r) => setTimeout(r, 10));
    saver.cancel();
    release(true);
    await b;
    expect(statuses).toEqual(["saving", "saving"]); // no late "error"
    expect(onError).not.toHaveBeenCalled();
  });

  it("saveShot surfaces storage_full as an AppError", async () => {
    setMock.mockRejectedValue(new DOMException("full", "QuotaExceededError"));
    await expect(saveShot("s", new Blob(["x"]))).rejects.toMatchObject({ kind: "storage_full" });
  });
});
