// Lane B. IndexedDB persistence with split keys (D8): `project`, `video`, `shot:<stepId>`.
import type { AppError } from "./errors";
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

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export async function loadAll(): Promise<{ project: Project; video: Blob } | null> {
  return notImplemented();
}

export async function saveProjectNow(project: Project): Promise<void> {
  void project;
  return notImplemented();
}

export function createDebouncedSaver(options: DebouncedSaverOptions = {}): DebouncedSaver {
  void options;
  return notImplemented();
}

export async function saveVideo(blob: Blob): Promise<void> {
  void blob;
  return notImplemented();
}

export async function saveShot(stepId: string, blob: Blob): Promise<void> {
  void stepId;
  void blob;
  return notImplemented();
}

export async function loadShot(stepId: string): Promise<Blob | null> {
  void stepId;
  return notImplemented();
}

export async function clearAll(): Promise<void> {
  return notImplemented();
}
