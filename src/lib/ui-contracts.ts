// Props for every component in the lane tables (IMPLEMENTATION.md, Lanes C, D, E).
// Type-only React import: this file has no runtime React dependency.
import type { ReactNode } from "react";
import type {
  HighlightSource,
  JobState,
  Rect,
  SaveStatus,
  SerializedAppError,
  Step,
  StepsAction,
  StepsState,
  VideoInfo,
} from "./types";

/** Focus target after capture finishes (D13). Rendered by ProjectTitle's h1. */
export const RESULTS_HEADING_ID = "results-heading";

export type RunningJob = Extract<JobState, { phase: "running" }>;
export type StepPatch = Extract<StepsAction, { type: "update" }>["patch"];
export type MoveDirection = "up" | "down";
export type ConfirmKind = "start_new" | "replace";

// ---------- Lane C: frames ----------
export type FramePickerProps = {
  open: boolean;
  /** Object URL of the stored video. */
  videoUrl: string;
  durationSec: number;
  /** The step's current timestamp; the picker opens here and marks it on the slider. */
  initialSec: number;
  /** 1-based, for the dialog title ("Pick a frame for step 3"). */
  stepNumber: number;
  onConfirm: (sec: number, shot: Blob) => void | Promise<void>;
  onCancel: () => void;
};

// ---------- Lane D: shell, upload, feedback, project ----------
export type AppHeaderProps = {
  saveStatus: SaveStatus;
  onStartNew?: () => void;
  /** Left, after the brand (the project title). Its presence switches the header to editor mode. */
  title?: ReactNode;
  /** Far right, after the save status and "Start new" (e.g. Export). */
  actions?: ReactNode;
};

export type DropzoneProps = { onFile: (file: File) => void; disabled?: boolean };
export type EmptyStateProps = { onFile: (file: File) => void };

export type JobProgressProps = { job: RunningJob; video: VideoInfo; onCancel: () => void };
export type CaptureBannerProps = { done: number; total: number };

export type ErrorPanelProps = {
  error: SerializedAppError;
  onPrimary: () => void;
  onSecondary?: () => void;
  /** Extra detail area, e.g. the "already uploaded" note. */
  children?: ReactNode;
};

export type BannerTone = "warning" | "info";
export type BannerProps = {
  tone: BannerTone;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
};

export type ConfirmDialogProps = {
  open: boolean;
  kind: ConfirmKind;
  onResolve: (ok: boolean) => void;
  /** The current project's title; the body names it ("This deletes “Create a purchase order”…"). */
  projectTitle?: string;
  /** "replace" only: the file waiting to be processed. */
  fileName?: string;
};

export type ProjectTitleProps = { value: string; onChange: (value: string) => void };
export type ExportButtonProps = { onExport: () => Promise<void> };
export type NoStepsProps = { onAddStep: () => void };

// ---------- Lane E: editor, highlight ----------
export type StepCardProps = {
  step: Step;
  /** 0-based position; the heading shows index + 1. */
  index: number;
  total: number;
  shotUrl?: string;
  onChange: (patch: StepPatch) => void;
  onMove: (direction: MoveDirection) => void;
  onDelete: () => void;
  onPickFrame: () => void;
  onHighlightChange: (rect: Rect | null, source: HighlightSource) => void;
};

export type StepListProps = {
  steps: Step[];
  shotUrls: Record<string, string>;
  dispatch: (action: StepsAction) => void;
  onPickFrame: (stepId: string) => void;
  onAddStep: (afterId: string | null) => void;
  /** StepList renders DeletedStepRow inline at `lastDeleted.index` and dispatches undoRemove/dismissUndo itself. */
  lastDeleted: StepsState["lastDeleted"];
};

/** Inline row shown where a step was deleted, with Undo (no timeout). */
export type DeletedStepRowProps = {
  deleted: { step: Step; index: number };
  onUndo: () => void;
  onDismiss: () => void;
};

/** Overlay only; Add / Remove / Reset-to-suggestion buttons live in StepCard's action row. */
export type HighlightEditorProps = {
  imageUrl: string;
  alt: string;
  /** 1-based; names the rectangle "Highlight on step N screenshot" (D9). */
  stepNumber: number;
  highlight: Rect | null;
  suggested: Rect | null;
  onChange: (rect: Rect | null) => void;
};

/** DOM id of a step card's "Step N" heading (1-based, display order).
 *  StepCard renders it (tabIndex -1); FramePicker falls back to focusing it
 *  when the element that opened the picker is gone after confirm (e.g. the
 *  capture-failed placeholder's "Pick frame" button). D13. */
export function stepHeadingDomId(stepNumber: number): string {
  return `step-${stepNumber}-heading`;
}
