// Lane B. IndexedDB persistence with split keys (D8): `project`, `video`, `shot:<stepId>`.
import { clear, get, set } from "idb-keyval";
import { AppError, toAppError } from "./errors";
import type { Project, SaveStatus } from "./types";

export type DebouncedSaver = {
  schedule: (project: Project) => void;
  /** Writes the pending project now. Called from the `pagehide` handler. */
  flush: () => Promise<void>;
  /**
   * Drops this saver's pending edit and invalidates every queued write, **from all savers**:
   * the generation is module-level (shared with `clearAll`), so a write queued by any saver
   * before this call is skipped, and one already in flight reports no status or error.
   */
  cancel: () => void;
};

export type DebouncedSaverOptions = {
  ms?: number;
  onStatus?: (status: SaveStatus) => void;
  /** Any write failure → AppError("storage_full"). */
  onError?: (error: AppError) => void;
};

const PROJECT_KEY = "project";
const VIDEO_KEY = "video";
const shotKey = (stepId: string) => `shot:${stepId}`;

// Module-level so `clearAll()` can wait for, and invalidate, writes queued by any saver.
// `cancel()` and `clearAll()` bump the generation; queued writes from an older generation
// are skipped, so a stale project can't land after "Start new" cleared the database.
let generation = 0;
let chain: Promise<void> = Promise.resolve(); // never rejects

/** Every write failure surfaces as storage_full: its copy ("changes won't survive a refresh")
 *  is accurate whatever IndexedDB complained about. The original stays as `cause`. */
async function write(op: () => Promise<void>): Promise<void> {
  try {
    await op();
  } catch (e) {
    throw new AppError("storage_full", undefined, { cause: e });
  }
}

export async function loadAll(): Promise<{ project: Project; video: Blob } | null> {
  try {
    const [project, video] = await Promise.all([get<Project>(PROJECT_KEY), get<Blob>(VIDEO_KEY)]);
    return project && video ? { project, video } : null;
  } catch (e) {
    throw toAppError(e);
  }
}

export async function saveProjectNow(project: Project): Promise<void> {
  return write(() => set(PROJECT_KEY, project));
}

export function createDebouncedSaver(options: DebouncedSaverOptions = {}): DebouncedSaver {
  const { ms = 500, onStatus, onError } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const flush = (): Promise<void> => {
    clearTimer();
    const project = pending;
    if (!project) return chain; // also waits for a write already in flight
    pending = null;
    const gen = generation;
    chain = chain.then(async () => {
      if (gen !== generation) return; // cancelled or cleared while queued
      onStatus?.("saving");
      try {
        await saveProjectNow(project);
        // Cancelled or cleared mid-write (e.g. "Start new"): the caller has reset its status.
        if (gen !== generation) return;
        // A newer edit scheduled meanwhile reports its own status.
        if (!pending) onStatus?.("saved");
      } catch (e) {
        if (gen !== generation) return;
        onStatus?.("error");
        onError?.(toAppError(e));
      }
    });
    return chain;
  };

  return {
    schedule(project) {
      pending = project;
      clearTimer();
      timer = setTimeout(() => void flush(), ms);
    },
    flush,
    cancel() {
      clearTimer();
      pending = null;
      generation++;
    },
  };
}

export async function saveVideo(blob: Blob): Promise<void> {
  return write(() => set(VIDEO_KEY, blob));
}

export async function saveShot(stepId: string, blob: Blob): Promise<void> {
  return write(() => set(shotKey(stepId), blob));
}

export async function loadShot(stepId: string): Promise<Blob | null> {
  try {
    return (await get<Blob>(shotKey(stepId))) ?? null;
  } catch (e) {
    throw toAppError(e);
  }
}

export async function clearAll(): Promise<void> {
  generation++;
  await chain; // let a write already in flight finish so it can't land after the clear
  try {
    await clear();
  } catch (e) {
    throw toAppError(e);
  }
}
