// Lane B. IndexedDB persistence with split keys (D8): `project`, `video`, `shot:<stepId>`.
import { clear, get, set } from "idb-keyval";
import { toAppError, type AppError } from "./errors";
import type { Project, SaveStatus } from "./types";

export type DebouncedSaver = {
  schedule: (project: Project) => void;
  /** Writes the pending project now. Called from the `pagehide` handler. */
  flush: () => Promise<void>;
  cancel: () => void;
};

export type DebouncedSaverOptions = {
  ms?: number;
  onStatus?: (status: SaveStatus) => void;
  /** QuotaExceededError → AppError("storage_full"). */
  onError?: (error: AppError) => void;
};

const PROJECT_KEY = "project";
const VIDEO_KEY = "video";
const shotKey = (stepId: string) => `shot:${stepId}`;

async function guarded<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    throw toAppError(e);
  }
}

export async function loadAll(): Promise<{ project: Project; video: Blob } | null> {
  return guarded(async () => {
    const [project, video] = await Promise.all([get<Project>(PROJECT_KEY), get<Blob>(VIDEO_KEY)]);
    return project && video ? { project, video } : null;
  });
}

export async function saveProjectNow(project: Project): Promise<void> {
  return guarded(() => set(PROJECT_KEY, project));
}

export function createDebouncedSaver(options: DebouncedSaverOptions = {}): DebouncedSaver {
  const { ms = 500, onStatus, onError } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const write = (): Promise<void> => {
    clearTimer();
    const project = pending;
    if (!project) return inFlight;
    pending = null;
    // Chain so writes land in order and flush() awaits the one in flight.
    inFlight = inFlight.then(async () => {
      try {
        await saveProjectNow(project);
        // A newer edit scheduled meanwhile reports its own status.
        if (!pending) onStatus?.("saved");
      } catch (e) {
        onStatus?.("error");
        onError?.(toAppError(e));
      }
    });
    return inFlight;
  };

  return {
    schedule(project) {
      pending = project;
      onStatus?.("saving");
      clearTimer();
      timer = setTimeout(() => void write(), ms);
    },
    flush: write,
    cancel() {
      clearTimer();
      pending = null;
    },
  };
}

export async function saveVideo(blob: Blob): Promise<void> {
  return guarded(() => set(VIDEO_KEY, blob));
}

export async function saveShot(stepId: string, blob: Blob): Promise<void> {
  return guarded(() => set(shotKey(stepId), blob));
}

export async function loadShot(stepId: string): Promise<Blob | null> {
  return guarded(async () => (await get<Blob>(shotKey(stepId))) ?? null);
}

export async function clearAll(): Promise<void> {
  return guarded(() => clear());
}
