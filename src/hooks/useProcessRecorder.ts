"use client";
// Lane F. The orchestrator hook (D7, D8, D10): runs the upload → analyze → capture job,
// owns autosave and every object URL, and exposes the `Recorder` contract to the page.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "@/components/shell/LiveRegion";
import { analyzeVideo, deleteGeminiFile, uploadVideo } from "@/lib/api-client";
import { AppError, ERROR_COPY, serialize, toAppError } from "@/lib/errors";
import { buildDocx, downloadBlob, exportFilename } from "@/lib/export-docx";
import { createFrameGrabber, probeVideo, validateFile, type FrameGrabber } from "@/lib/frames";
import { initialJob, jobReducer } from "@/lib/job-machine";
import { isLongVideo, withVideoType } from "@/lib/limits";
import {
  clearAll,
  createDebouncedSaver,
  loadAll,
  loadShot,
  saveProjectNow,
  saveShot,
  saveVideo,
  type DebouncedSaver,
} from "@/lib/persistence";
import { initialSteps, stepsReducer } from "@/lib/steps-reducer";
import { createStep, stepsFromRaw } from "@/lib/steps";
import { formatTimestamp } from "@/lib/timestamp";
import type {
  JobAction,
  JobStage,
  JobState,
  Project,
  Recorder,
  RetryFrom,
  SaveStatus,
  Step,
  StepsAction,
  StepsState,
  VideoInfo,
} from "@/lib/types";
import { RESULTS_HEADING_ID, type ConfirmKind } from "@/lib/ui-contracts";

/** What the job runs on. Kept after a failure so Retry can resume without the original File. */
type Source = { blob: Blob; info: VideoInfo; gemini?: NonNullable<Project["gemini"]> };

const STAGE_LABEL: Record<JobStage, string | null> = {
  validating: null,
  received: "Receiving video",
  sending_to_gemini: "Sending to Gemini",
  gemini_processing: "Gemini processing",
  analyzing: "Analyzing steps",
  capturing: "Capturing screenshots",
};

const STAGE_ORDER: JobStage[] = [
  "validating",
  "received",
  "sending_to_gemini",
  "gemini_processing",
  "analyzing",
  "capturing",
];

export function longVideoNotice(durationSec: number): string {
  return `This recording is ${formatTimestamp(durationSec)}. Longer recordings take longer to process and are more likely to miss steps. Check the list carefully.`;
}

function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || "Untitled process";
}

/** Where a failure at `stage` resumes. Non-retryable kinds stay null; an expired file always re-uploads. */
export function retryFromFor(kind: AppError["kind"], stage: JobStage): RetryFrom | null {
  const fallback = ERROR_COPY[kind].retryFrom;
  if (fallback === null || kind === "file_expired") return fallback;
  if (stage === "analyzing") return "analyze";
  if (stage === "capturing") return "capture";
  return "upload";
}

/** A reducer whose latest state is also readable synchronously from async code (the job loop). */
function useSyncedReducer<S, A>(reducer: (s: S, a: A) => S, initial: S) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const dispatch = useCallback(
    (action: A) => {
      ref.current = reducer(ref.current, action);
      setState(ref.current);
    },
    [reducer],
  );
  return [state, dispatch, ref] as const;
}

export function useProcessRecorder(): Recorder {
  const announce = useAnnounce();

  const [job, jobDispatch, jobRef] = useSyncedReducer<JobState, JobAction>(jobReducer, initialJob);
  const [steps, stepsDispatch, stepsRef] = useSyncedReducer<StepsState, StepsAction>(stepsReducer, initialSteps);
  const [projectMeta, setProjectMetaState] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const [shotUrls, setShotUrls] = useState<Record<string, string>>({});
  const [videoUrl, setVideoUrlState] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [storageFull, setStorageFull] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmKind | null>(null);

  // Bumped by cancel / start new / replace / unmount. Async work started under an older
  // generation drops its results instead of touching the new state.
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const stageRef = useRef<JobStage | null>(null);
  const sourceRef = useRef<Source | null>(null);
  /** True once the project is in IndexedDB (first persist or restore): enables autosave and the replace confirm. */
  const savedRef = useRef(false);
  const lastScheduledRef = useRef<{ project: Project | null; steps: Step[] | null }>({ project: null, steps: null });
  const saverRef = useRef<DebouncedSaver | null>(null);
  const grabberRef = useRef<FrameGrabber | null>(null);
  const shotUrlsRef = useRef<Record<string, string>>({});
  const shotBlobsRef = useRef(new Map<string, Blob>());
  const videoUrlRef = useRef<string | null>(null);
  const busyShotsRef = useRef(new Set<string>());
  const focusResultsRef = useRef(false);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  /** IndexedDB writes still in flight; teardown waits for them before clearAll. */
  const writesRef = useRef(new Set<Promise<void>>());
  /** The storage half of the last teardown; a new job waits for it before writing. */
  const cleanupRef = useRef<Promise<void>>(Promise.resolve());
  /** Settles once the mount-time restore has finished (or found nothing). */
  const restoreRef = useRef<Promise<void>>(Promise.resolve());
  /** onFile is between the drop and the job's start (awaiting restore, confirm or cleanup). */
  const startingRef = useRef(false);

  const setProject = useCallback((next: Project | null | ((p: Project | null) => Project | null)) => {
    projectRef.current = typeof next === "function" ? next(projectRef.current) : next;
    setProjectMetaState(projectRef.current);
  }, []);

  // ---------- object URLs ----------

  const setVideoBlob = useCallback((blob: Blob | null) => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = blob ? URL.createObjectURL(blob) : null;
    setVideoUrlState(videoUrlRef.current);
  }, []);

  const setShot = useCallback((stepId: string, blob: Blob) => {
    shotBlobsRef.current.set(stepId, blob);
    const old = shotUrlsRef.current[stepId];
    if (old) URL.revokeObjectURL(old);
    shotUrlsRef.current = { ...shotUrlsRef.current, [stepId]: URL.createObjectURL(blob) };
    setShotUrls(shotUrlsRef.current);
  }, []);

  const releaseMedia = useCallback(() => {
    for (const url of Object.values(shotUrlsRef.current)) URL.revokeObjectURL(url);
    shotUrlsRef.current = {};
    shotBlobsRef.current.clear();
    setShotUrls({});
    setVideoBlob(null);
    grabberRef.current?.dispose();
    grabberRef.current = null;
  }, [setVideoBlob]);

  const getGrabber = useCallback((): FrameGrabber | null => {
    if (!grabberRef.current && sourceRef.current) grabberRef.current = createFrameGrabber(sourceRef.current.blob);
    return grabberRef.current;
  }, []);

  // ---------- persistence helpers ----------

  /** Persistence failures never stop the job: storage_full shows the banner, the editor keeps working in memory. */
  const persistSafe = useCallback(async (write: () => Promise<void>): Promise<boolean> => {
    let pending: Promise<void> | undefined;
    try {
      pending = write();
      writesRef.current.add(pending);
      await pending;
      return true;
    } catch (e) {
      const err = toAppError(e);
      if (err.kind === "storage_full") setStorageFull(true);
      else console.warn("Persistence failed", e);
      return false;
    } finally {
      if (pending) writesRef.current.delete(pending);
    }
  }, []);

  useEffect(() => {
    const saver = createDebouncedSaver({
      ms: 500,
      onStatus: setSaveStatus,
      onError: (err) => {
        setSaveStatus("error");
        if (err.kind === "storage_full") setStorageFull(true);
      },
    });
    saverRef.current = saver;
    const onPageHide = () => void saver.flush();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void saver.flush();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, []);

  // Autosave: steps and title go through the debounced saver once the project is persisted.
  useEffect(() => {
    if (!savedRef.current || !projectMeta) return;
    const last = lastScheduledRef.current;
    if (last.project === projectMeta && last.steps === steps.steps) return;
    lastScheduledRef.current = { project: projectMeta, steps: steps.steps };
    saverRef.current?.schedule({ ...projectMeta, steps: steps.steps, updatedAt: new Date().toISOString() });
  }, [projectMeta, steps.steps]);

  useEffect(() => {
    if (storageFull) announce(ERROR_COPY.storage_full.body());
  }, [storageFull, announce]);

  // ---------- focus after capture (D13) ----------

  useEffect(() => {
    if (job.phase !== "ready" || !focusResultsRef.current) return;
    focusResultsRef.current = false;
    document.getElementById(RESULTS_HEADING_ID)?.focus();
  }, [job.phase]);

  // ---------- confirm dialog ----------

  const askConfirm = useCallback((kind: ConfirmKind) => {
    confirmResolverRef.current?.(false);
    setPendingConfirm(kind);
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }, []);

  const resolveConfirm = useCallback((ok: boolean) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setPendingConfirm(null);
    resolve?.(ok);
  }, []);

  // ---------- teardown ----------

  /** Drops the current job and project from memory, IndexedDB and Gemini (best effort). */
  const teardown = useCallback(
    (jobAction: "cancel" | "reset"): Promise<void> => {
      genRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      const saver = saverRef.current;
      saver?.cancel();
      const fileName = projectRef.current?.gemini?.fileName ?? sourceRef.current?.gemini?.fileName;
      sourceRef.current = null;
      savedRef.current = false;
      stageRef.current = null;
      lastScheduledRef.current = { project: null, steps: null };
      busyShotsRef.current.clear();
      releaseMedia();
      setProject(null);
      stepsDispatch({ type: "load", steps: [] });
      jobDispatch({ type: jobAction });
      setSaveStatus("idle");
      setStorageFull(false);
      // Let in-flight writes land first, so clearAll can't be overtaken and resurrect the project.
      // flush() after cancel() only waits for a write already running.
      const inFlight = [...writesRef.current, saver?.flush()];
      const storage = (async () => {
        await Promise.allSettled(inFlight);
        await clearAll().catch((e: unknown) => console.warn("Couldn't clear storage", e));
      })();
      cleanupRef.current = storage;
      const gemini = fileName ? deleteGeminiFile(fileName).catch(() => {}) : undefined;
      return Promise.all([gemini, storage]).then(() => {});
    },
    [releaseMedia, setProject, stepsDispatch, jobDispatch],
  );

  // ---------- the job ----------

  const goToStage = useCallback(
    (stage: JobStage, announceIt = true) => {
      if (stageRef.current === stage) return;
      stageRef.current = stage;
      jobDispatch({ type: "stage", stage, at: Date.now() });
      const label = STAGE_LABEL[stage];
      if (announceIt && label) announce(label);
    },
    [jobDispatch, announce],
  );

  /** Marks the stages before `stage` as completed (a retry resumes mid-list), then enters it. */
  const resumeAt = useCallback(
    (stage: JobStage, announceIt = true) => {
      for (const s of STAGE_ORDER.slice(1, STAGE_ORDER.indexOf(stage))) goToStage(s, false);
      goToStage(stage, announceIt);
    },
    [goToStage],
  );

  /** Captures one step's frame into state + IndexedDB. Failures mark that step only (capture_failed). */
  const captureInto = useCallback(
    async (stepId: string, sec: number, gen: number, signal?: AbortSignal) => {
      const grabber = getGrabber();
      if (!grabber) {
        stepsDispatch({ type: "setCaptureState", id: stepId, captureState: "failed" });
        return;
      }
      busyShotsRef.current.add(stepId);
      try {
        const blob = await grabber.capture(sec, { signal });
        if (gen !== genRef.current) return;
        setShot(stepId, blob);
        stepsDispatch({ type: "setCaptureState", id: stepId, captureState: "ok" });
        await persistSafe(() => saveShot(stepId, blob));
      } catch {
        if (gen === genRef.current) stepsDispatch({ type: "setCaptureState", id: stepId, captureState: "failed" });
      } finally {
        busyShotsRef.current.delete(stepId);
      }
    },
    [getGrabber, setShot, stepsDispatch, persistSafe],
  );

  /** Sequential capture of every step without a shot. Cancel stops it; the rest become "failed" (Pick frame). */
  const captureAll = useCallback(
    async (gen: number, signal: AbortSignal) => {
      const targets = stepsRef.current.steps.filter((s) => s.captureState !== "ok").map((s) => s.id);
      const total = targets.length;
      let done = 0;
      jobDispatch({ type: "captureProgress", done, total });
      for (const id of targets) {
        if (signal.aborted || gen !== genRef.current) break;
        const step = stepsRef.current.steps.find((s) => s.id === id);
        if (step && step.captureState !== "ok" && !busyShotsRef.current.has(id)) {
          if (step.captureState === "failed") stepsDispatch({ type: "setCaptureState", id, captureState: "pending" });
          await captureInto(id, step.timestampSec, gen, signal);
        }
        if (gen !== genRef.current) return;
        jobDispatch({ type: "captureProgress", done: ++done, total });
      }
      if (gen !== genRef.current) return;
      for (const id of targets) {
        const step = stepsRef.current.steps.find((s) => s.id === id);
        if (step?.captureState === "pending" && !busyShotsRef.current.has(id)) {
          stepsDispatch({ type: "setCaptureState", id, captureState: "failed" });
        }
      }
    },
    [stepsRef, jobDispatch, stepsDispatch, captureInto],
  );

  /** Runs the job from `from` (validate a new file, or resume after an error) to ready or error. */
  const runJob = useCallback(
    async (start: { file: File } | { from: RetryFrom; source: Source }) => {
      const gen = ++genRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      const alive = () => gen === genRef.current;
      const check = () => {
        if (signal.aborted || !alive()) throw new AppError("cancelled");
      };

      stageRef.current = "validating";
      jobDispatch({ type: "start", at: Date.now() });

      try {
        let source: Source;
        let from: RetryFrom;
        if ("file" in start) {
          // Give type-less files (e.g. .mov on Windows) a MIME type before anything else sees them.
          const file = withVideoType(start.file);
          // In-memory draft so JobProgress has the video info (from the File while validating,
          // then the probe's); persisted only after analysis.
          const draft = (video: VideoInfo): Project => ({
            id: crypto.randomUUID(),
            title: titleFromFileName(file.name),
            video,
            steps: [],
            updatedAt: new Date().toISOString(),
          });
          setProject(
            draft({ name: file.name, sizeBytes: file.size, mimeType: file.type, durationSec: 0, width: 0, height: 0 }),
          );
          validateFile(file);
          const info = await probeVideo(file);
          check();
          source = { blob: file, info };
          sourceRef.current = source;
          setProject(draft(info));
          setVideoBlob(file);
          await persistSafe(() => saveVideo(file));
          check();
          from = "upload";
        } else {
          source = start.source;
          from = start.from;
        }

        const longNotice = isLongVideo(source.info.durationSec) ? ` ${longVideoNotice(source.info.durationSec)}` : "";
        let noticeSent = false;
        const firstAnnouncement = (label: string) => {
          if (noticeSent) return label;
          noticeSent = true;
          return label + longNotice;
        };

        if (from === "upload") {
          const uploaded = await uploadVideo(source.blob, {
            signal,
            onStage: (stage) => {
              if (!alive() || signal.aborted) return;
              goToStage(stage, false);
              announce(firstAnnouncement(STAGE_LABEL[stage] ?? stage));
            },
          });
          check();
          source.gemini = { ...uploaded, uploadedAt: new Date().toISOString() };
        }

        if (from === "upload" || from === "analyze") {
          const gemini = source.gemini;
          if (!gemini) throw new AppError("file_expired");
          resumeAt("analyzing", false);
          announce(firstAnnouncement("Analyzing steps"));
          const result = await analyzeVideo(gemini.fileName, { signal });
          check();
          const newSteps = stepsFromRaw(result.steps, source.info.durationSec);
          const project: Project = {
            id: projectRef.current?.id ?? crypto.randomUUID(),
            title: result.processTitle.trim() || titleFromFileName(source.info.name),
            video: source.info,
            gemini,
            steps: newSteps,
            updatedAt: new Date().toISOString(),
          };
          stepsDispatch({ type: "load", steps: newSteps });
          setProject(project);
          lastScheduledRef.current = { project, steps: stepsRef.current.steps };
          // First persist of the project; autosave takes over from here.
          setSaveStatus("saving");
          const saved = await persistSafe(() => saveProjectNow(project));
          check(); // cancelled during the first persist: teardown has already reset state and storage
          setSaveStatus(saved ? "saved" : "error");
          savedRef.current = true;
        }

        resumeAt("capturing");
        await captureAll(gen, signal);
        if (!alive()) return;
        const stopped = signal.aborted; // cancel() during capture

        focusResultsRef.current = true;
        abortRef.current = null;
        stageRef.current = null;
        jobDispatch({ type: "succeed" });
        const n = stepsRef.current.steps.length;
        const summary =
          n === 0 ? "No steps found. Add a step manually." : `${n} ${n === 1 ? "step" : "steps"} ready`;
        // One message: a second announce() would replace the first before it is read.
        announce(stopped ? `Capture stopped. ${summary}` : summary);
      } catch (e) {
        if (!alive() || signal.aborted) return;
        const err = toAppError(e);
        const stage = stageRef.current ?? "validating";
        abortRef.current = null;
        stageRef.current = null;
        jobDispatch({ type: "fail", error: serialize(err), retryFrom: retryFromFor(err.kind, stage) });
      }
    },
    [
      jobDispatch,
      stepsDispatch,
      stepsRef,
      setProject,
      setVideoBlob,
      persistSafe,
      goToStage,
      resumeAt,
      captureAll,
      announce,
    ],
  );

  // ---------- mount: restore ----------

  useEffect(() => {
    let cancelled = false;
    restoreRef.current = (async () => {
      let loaded: Awaited<ReturnType<typeof loadAll>>;
      try {
        loaded = await loadAll();
      } catch (e) {
        console.warn("Couldn't restore the last project", e);
        return;
      }
      if (cancelled || !loaded || jobRef.current.phase !== "idle") return;
      const { project, video } = loaded;
      const shots = await Promise.all(project.steps.map((s) => loadShot(s.id).catch(() => null)));
      if (cancelled || jobRef.current.phase !== "idle") return;

      sourceRef.current = { blob: video, info: project.video, gemini: project.gemini };
      setVideoBlob(video);
      // A refresh mid-capture leaves steps "pending"; without a shot they become "failed" (Pick frame).
      const restored = project.steps.map((s, i): Step => {
        const shot = shots[i];
        if (shot) {
          setShot(s.id, shot);
          return s.captureState === "pending" ? { ...s, captureState: "ok" } : s;
        }
        return s.captureState === "failed" ? s : { ...s, captureState: "failed" };
      });
      const meta = { ...project, steps: restored };
      stepsDispatch({ type: "load", steps: restored });
      setProject(meta);
      lastScheduledRef.current = { project: meta, steps: stepsRef.current.steps };
      savedRef.current = true;
      jobDispatch({ type: "restore" });
      announce("Restored your last project");
    })();
    return () => {
      cancelled = true;
    };
  }, [jobRef, stepsRef, jobDispatch, stepsDispatch, setProject, setVideoBlob, setShot, announce]);

  // Unmount: stop the job and release every object URL. Deferred one tick so that an effect
  // re-run (StrictMode, Fast Refresh: cleanup then setup straight away) cancels it and the
  // thumbnails keep working; only a real unmount gets as far as revoking.
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseOnUnmount = useCallback(() => {
    genRef.current++;
    abortRef.current?.abort();
    for (const url of Object.values(shotUrlsRef.current)) URL.revokeObjectURL(url);
    shotUrlsRef.current = {};
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = null;
    grabberRef.current?.dispose();
    grabberRef.current = null;
  }, []);
  useEffect(() => {
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    unmountTimerRef.current = null;
    return () => {
      unmountTimerRef.current = setTimeout(releaseOnUnmount, 0);
    };
  }, [releaseOnUnmount]);

  // ---------- Recorder actions ----------

  const onFile = useCallback(
    (file: File) => {
      // One file at a time: a second drop while this one waits (restore, confirm, cleanup) or runs is ignored.
      if (startingRef.current || jobRef.current.phase === "running") return;
      startingRef.current = true;
      void (async () => {
        try {
          // Wait for the mount-time restore, so a restored project is confirmed and cleared
          // rather than left in IndexedDB under the new video.
          await restoreRef.current;
          if (savedRef.current) {
            if (!(await askConfirm("replace"))) return;
            await teardown("reset");
          } else if (sourceRef.current || projectRef.current) {
            // An unsaved earlier attempt (e.g. analysis failed): drop its Gemini file and stored video (D8).
            await teardown("reset");
          }
          await cleanupRef.current;
        } finally {
          startingRef.current = false;
        }
        await runJob({ file });
      })();
    },
    [jobRef, askConfirm, teardown, runJob],
  );

  const retry = useCallback(() => {
    const current = jobRef.current;
    const source = sourceRef.current;
    if (current.phase !== "error" || !source) return;
    let from = current.retryFrom ?? ERROR_COPY[current.error.kind].retryFrom;
    if (from === null) return;
    if (from === "capture" && !savedRef.current) from = "analyze";
    if (from === "analyze" && !source.gemini) from = "upload";
    void runJob({ from, source });
  }, [jobRef, runJob]);

  const cancel = useCallback(() => {
    if (jobRef.current.phase !== "running") return;
    if (stageRef.current === "capturing") {
      // Defensive path: CaptureBanner has no Cancel today, so the UI can't reach this.
      // The project already exists: stop capturing and finish with "Pick frame" placeholders.
      abortRef.current?.abort();
      return;
    }
    void teardown("cancel");
    announce("Cancelled");
  }, [jobRef, teardown, announce]);

  const confirmStartNew = useCallback(async () => {
    await teardown("reset");
  }, [teardown]);

  const startNew = useCallback(() => {
    void askConfirm("start_new").then((ok) => (ok ? confirmStartNew() : undefined));
  }, [askConfirm, confirmStartNew]);

  const setTitle = useCallback(
    (title: string) => setProject((p) => (p ? { ...p, title } : p)),
    [setProject],
  );

  const repick = useCallback(
    async (stepId: string, sec: number, shot: Blob) => {
      stepsDispatch({ type: "setTimestamp", id: stepId, timestampSec: sec });
      setShot(stepId, shot);
      stepsDispatch({ type: "setCaptureState", id: stepId, captureState: "ok" });
      await persistSafe(() => saveShot(stepId, shot));
    },
    [stepsDispatch, setShot, persistSafe],
  );

  const addStep = useCallback(
    async (afterId: string | null) => {
      const prev = afterId ? stepsRef.current.steps.find((s) => s.id === afterId) : undefined;
      const duration = projectRef.current?.video.durationSec ?? 0;
      const sec = prev ? Math.min(duration, prev.timestampSec + 1) : 0;
      const step = createStep({}, sec);
      stepsDispatch({ type: "add", afterId, step });
      await captureInto(step.id, sec, genRef.current);
    },
    [stepsRef, stepsDispatch, captureInto],
  );

  const exportDocx = useCallback(async () => {
    const meta = projectRef.current;
    if (!meta) return;
    const current = stepsRef.current.steps;
    const getShot = async (id: string) => shotBlobsRef.current.get(id) ?? (await loadShot(id).catch(() => null));
    const blob = await buildDocx({ ...meta, steps: current }, current, getShot);
    downloadBlob(blob, exportFilename(meta.title));
  }, [stepsRef]);

  const project = useMemo(
    () => (projectMeta ? { ...projectMeta, steps: steps.steps } : null),
    [projectMeta, steps.steps],
  );

  return {
    job,
    project,
    steps,
    dispatch: stepsDispatch,
    shotUrls,
    videoUrl,
    saveStatus,
    storageFull,
    onFile,
    retry,
    cancel,
    startNew,
    confirmStartNew,
    pendingConfirm,
    resolveConfirm,
    setTitle,
    repick,
    addStep,
    exportDocx,
  };
}
