// ---------- Domain ----------
export type Rect = { x: number; y: number; w: number; h: number }; // normalized 0–1

export type CaptureState = "pending" | "ok" | "failed";
export type HighlightSource = "gemini" | "user" | null;

export type Step = {
  id: string;
  action: string;
  description: string;
  expectedResult: string;
  timestampSec: number;
  captureState: CaptureState;
  highlight: Rect | null;
  highlightSource: HighlightSource;
  suggestedHighlight: Rect | null; // Gemini's box for this step's original frame; enables "Reset to suggestion"
};

export type VideoInfo = {
  name: string;
  sizeBytes: number;
  mimeType: string;
  durationSec: number;
  width: number;
  height: number;
};

export type Project = {
  id: string;
  title: string;
  video: VideoInfo;
  gemini?: { fileName: string; mimeType: string; uploadedAt: string };
  steps: Step[];
  updatedAt: string;
};

// ---------- HTTP contract (D4) ----------
export type UploadStage = "received" | "sending_to_gemini" | "gemini_processing";

export type UploadEvent =
  | { type: "stage"; stage: UploadStage }
  | { type: "ready"; fileName: string; mimeType: string }
  | { type: "error"; error: SerializedAppError };

export type RawStep = {            // server output: sorted, de-duplicated, box converted
  action: string;
  description: string;
  expectedResult: string;
  timestampSec: number;
  box: Rect | null;
};

export type AnalyzeResponse =
  | { ok: true; processTitle: string; steps: RawStep[] }   // steps may be [] → NoSteps UI, not an error
  | { ok: false; error: SerializedAppError };

// ---------- Errors (D10) ----------
export type ErrorKind =
  | "missing_api_key" | "unsupported_type" | "too_long" | "too_large" | "undecodable"
  | "network" | "rate_limited" | "gemini_failed" | "gemini_blocked" | "bad_model_output"
  | "file_expired" | "not_screen_recording" | "capture_failed" | "storage_full" | "cancelled";

/** `detail` is display-ready text produced by whoever raises the error,
 *  e.g. too_long → "12:40", too_large → "640 MB", unsupported_type → ".pdf",
 *  not_screen_recording → the model's rejectionReason. */
export type SerializedAppError = { kind: ErrorKind; detail?: string };

// ---------- Job state machine (D7) ----------
export type JobStage = "validating" | UploadStage | "analyzing" | "capturing";
export type RetryFrom = "upload" | "analyze" | "capture";

export type JobState =
  | { phase: "idle" }
  | { phase: "running"; stage: JobStage; stageStartedAt: number; completed: JobStage[];
      capture?: { done: number; total: number } }
  | { phase: "ready" }
  | { phase: "error"; error: SerializedAppError; retryFrom: RetryFrom | null };

export type JobAction =
  | { type: "start"; at: number }                    // idle|error|ready → running(validating)
  | { type: "stage"; stage: JobStage; at: number }   // running → running
  | { type: "captureProgress"; done: number; total: number }
  | { type: "succeed" }                              // running → ready
  | { type: "restore" }                              // idle → ready (project loaded from IndexedDB)
  | { type: "fail"; error: SerializedAppError; retryFrom: RetryFrom | null }
  | { type: "cancel" }                               // running → idle
  | { type: "reset" };                               // any → idle

// ---------- Steps reducer (D7, D12) ----------
export type StepsState = { steps: Step[]; lastDeleted: { step: Step; index: number } | null };

export type StepsAction =
  | { type: "load"; steps: Step[] }
  | { type: "update"; id: string; patch: Partial<Pick<Step, "action" | "description" | "expectedResult">> }
  | { type: "add"; afterId: string | null; step: Step }      // caller builds the step with createStep()
  | { type: "remove"; id: string }                           // keeps the shot in IndexedDB so undo works
  | { type: "undoRemove" }
  | { type: "dismissUndo" }
  | { type: "move"; id: string; direction: "up" | "down" }
  | { type: "setTimestamp"; id: string; timestampSec: number } // re-pick: always clears suggestedHighlight (the suggestion belonged to the old frame, D9); clears highlight too if its source was "gemini", keeps a user-drawn one
  | { type: "setCaptureState"; id: string; captureState: CaptureState }
  | { type: "setHighlight"; id: string; highlight: Rect | null; source: HighlightSource };

// ---------- Orchestrator (Lane F) ----------
export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type Recorder = {
  job: JobState;
  /** The current project. Between probe and the end of analysis this is an
   *  in-memory draft (never persisted) so JobProgress can show VideoInfo;
   *  the page only renders the editor from it in `ready` or `running/capturing`. */
  project: Project | null;
  steps: StepsState;
  dispatch: (a: StepsAction) => void;
  shotUrls: Record<string, string>;     // stepId → object URL (hook owns the lifecycle)
  videoUrl: string | null;              // object URL of the stored video (hook owns it)
  saveStatus: SaveStatus;
  storageFull: boolean;
  onFile: (file: File) => void;         // asks "Replace current project?" if one exists
  retry: () => void;
  cancel: () => void;
  startNew: () => void;                 // opens the confirm; confirmStartNew() does the work
  confirmStartNew: () => Promise<void>;
  pendingConfirm: "start_new" | "replace" | null;
  /** While `pendingConfirm` is "replace": the name of the file waiting to be processed. */
  pendingFileName: string | null;
  resolveConfirm: (ok: boolean) => void;
  setTitle: (t: string) => void;
  repick: (stepId: string, sec: number, shot: Blob) => Promise<void>;
  addStep: (afterId: string | null) => Promise<void>; // captures a frame at prev.timestamp + 1 s
  exportDocx: () => Promise<void>;
};
