// In-memory fakes with the exact shapes of the real modules, for dev pages, Lane F and tests.
// Each factory is typed against the real module, so a signature change breaks the fake at compile time.
import type * as ApiClient from "@/lib/api-client";
import { AppError } from "@/lib/errors";
import type * as Frames from "@/lib/frames";
import { ACCEPTED_TYPES, MAX_BYTES } from "@/lib/limits";
import type * as Persistence from "@/lib/persistence";
import { formatBytes } from "@/lib/timestamp";
import type { AnalyzeResponse, Project, RawStep, SerializedAppError } from "@/lib/types";
import analyzeOk from "./http/analyze-ok.json";
import { fixtureProject } from "./project";

type PersistenceApi = Pick<
  typeof Persistence,
  "loadAll" | "saveProjectNow" | "createDebouncedSaver" | "saveVideo" | "saveShot" | "loadShot" | "clearAll"
>;
type ApiClientApi = Pick<typeof ApiClient, "uploadVideo" | "analyzeVideo" | "deleteGeminiFile">;
type FramesApi = Pick<typeof Frames, "validateFile" | "probeVideo" | "createFrameGrabber" | "captureFromVideo">;

/** Resolves after `ms`; rejects with AppError("cancelled") if the signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError("cancelled"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AppError("cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------- persistence ----------

export type FakePersistence = PersistenceApi & {
  /** Inspect what was "stored". */
  store: { project: Project | null; video: Blob | null; shots: Map<string, Blob> };
};

export function createFakePersistence(
  initial: { project?: Project; video?: Blob } = {},
  { delayMs = 50 }: { delayMs?: number } = {},
): FakePersistence {
  const store = {
    project: initial.project ? structuredClone(initial.project) : null,
    video: initial.video ?? null,
    shots: new Map<string, Blob>(),
  };
  const saveProjectNow = async (p: Project) => {
    await delay(delayMs);
    store.project = structuredClone(p);
  };
  return {
    store,
    loadAll: async () => {
      await delay(delayMs);
      return store.project && store.video ? { project: structuredClone(store.project), video: store.video } : null;
    },
    saveProjectNow,
    createDebouncedSaver: ({ ms = 500, onStatus } = {}) => {
      let pending: Project | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = async () => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (!pending) return;
        const p = pending;
        pending = null;
        onStatus?.("saving");
        await saveProjectNow(p);
        onStatus?.("saved");
      };
      return {
        schedule: (p) => {
          pending = p;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void flush(), ms);
        },
        flush,
        cancel: () => {
          if (timer) clearTimeout(timer);
          timer = null;
          pending = null;
        },
      };
    },
    saveVideo: async (blob) => {
      store.video = blob;
    },
    saveShot: async (id, blob) => {
      store.shots.set(id, blob);
    },
    loadShot: async (id) => store.shots.get(id) ?? null,
    clearAll: async () => {
      store.project = null;
      store.video = null;
      store.shots.clear();
    },
  };
}

// ---------- api-client ----------

export type FakeApiOptions = {
  /** Per stage / per call. */
  delayMs?: number;
  /** Make uploadVideo or analyzeVideo fail with this error. */
  uploadError?: SerializedAppError;
  analyzeError?: SerializedAppError;
  /** Defaults to src/fixtures/http/analyze-ok.json. */
  analyzeResult?: { processTitle: string; steps: RawStep[] };
};

export type FakeApiClient = ApiClientApi & { calls: { upload: number; analyze: number; delete: string[] } };

export function createFakeApiClient(options: FakeApiOptions = {}): FakeApiClient {
  const { delayMs = 400 } = options;
  const ok = analyzeOk as unknown as Extract<AnalyzeResponse, { ok: true }>;
  const result = options.analyzeResult ?? { processTitle: ok.processTitle, steps: ok.steps };
  const calls = { upload: 0, analyze: 0, delete: [] as string[] };
  return {
    calls,
    uploadVideo: async (file, { signal, onStage } = {}) => {
      calls.upload++;
      for (const stage of ["received", "sending_to_gemini", "gemini_processing"] as const) {
        onStage?.(stage);
        await delay(delayMs, signal);
      }
      if (options.uploadError) throw new AppError(options.uploadError.kind, options.uploadError.detail);
      return { fileName: "files/fake0001", mimeType: file.type || "video/mp4" };
    },
    analyzeVideo: async (_fileName, { signal } = {}) => {
      calls.analyze++;
      await delay(delayMs * 2, signal);
      if (options.analyzeError) throw new AppError(options.analyzeError.kind, options.analyzeError.detail);
      return structuredClone(result);
    },
    deleteGeminiFile: async (fileName) => {
      calls.delete.push(fileName);
    },
  };
}

// ---------- frames ----------

export type FakeFramesOptions = {
  delayMs?: number;
  /** Duration reported by probeVideo. Defaults to the fixture project's. */
  durationSec?: number;
  /** Seconds at which capture fails with capture_failed. */
  failAt?: number[];
  /** Produces the captured image. Defaults to a tiny placeholder WebP-typed blob. */
  makeShot?: (sec: number) => Promise<Blob>;
};

const placeholderShot = async () => new Blob([new Uint8Array(32)], { type: "image/webp" });

export function createFakeFrames(options: FakeFramesOptions = {}): FramesApi {
  const { delayMs = 150, failAt = [], makeShot = placeholderShot } = options;
  const { width, height } = fixtureProject.video;
  return {
    validateFile: (file) => {
      if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
        const ext = file.name.includes(".") ? `.${file.name.split(".").pop()}` : file.type || "file";
        throw new AppError("unsupported_type", ext);
      }
      if (file.size > MAX_BYTES) throw new AppError("too_large", formatBytes(file.size));
    },
    probeVideo: async (file) => {
      await delay(delayMs);
      return {
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
        durationSec: options.durationSec ?? fixtureProject.video.durationSec,
        width,
        height,
      };
    },
    createFrameGrabber: () => ({
      capture: async (sec, { signal } = {}) => {
        await delay(delayMs, signal);
        if (failAt.includes(sec)) throw new AppError("capture_failed");
        return makeShot(sec);
      },
      dispose: () => {},
    }),
    captureFromVideo: async (video) => makeShot(video.currentTime),
  };
}

/** Browser-only helper: fetches a fixture shot (see `fixtureShotUrls`) as a Blob. */
export async function fetchShot(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}
