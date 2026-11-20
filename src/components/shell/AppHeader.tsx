import { Children, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { AppHeaderProps } from "@/lib/ui-contracts";
import type { SaveStatus } from "@/lib/types";
import { buttonClass } from "./button-styles";
import { Spinner } from "./Spinner";

/**
 * App header. Sticky, so Export and the save status stay visible with 20+ steps.
 *
 * `children` is "title + export slot": pass the title first and the actions after it,
 * as separate children (not wrapped in one fragment), e.g.
 * `<AppHeader …><ProjectTitle …/><ExportButton …/></AppHeader>`.
 * The first child goes on the left, after the brand; the rest go at the far right, after
 * the save status and "Start new", matching the EditorHeader board.
 */
export function AppHeader({ saveStatus, onStartNew, children }: AppHeaderProps) {
  const [title, ...actions] = Children.toArray(children);
  const inEditor = title !== undefined;

  return (
    <header className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border bg-card px-[clamp(16px,4vw,32px)] py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Brand muted={inEditor} />
        {inEditor && (
          <>
            <div aria-hidden="true" className="h-6 w-px bg-border" />
            {title}
          </>
        )}
      </div>
      {(inEditor || onStartNew) && (
        <div className="flex flex-wrap items-center gap-3">
          <SaveIndicator status={saveStatus} />
          {onStartNew && (
            <button type="button" className={buttonClass("secondary", "lg", "px-4")} onClick={onStartNew}>
              Start new
            </button>
          )}
          {actions as ReactNode[]}
        </div>
      )}
    </header>
  );
}

function Brand({ muted }: { muted: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-foreground">
        <div className="size-2.5 rounded-full bg-card" />
      </div>
      <p
        className={
          muted
            ? "text-sm font-semibold text-foreground-2"
            : "text-base leading-5 font-semibold tracking-[-0.01em]"
        }
      >
        Process Recorder
      </p>
    </div>
  );
}

/** Visual only. Not a live region: the storage-full state is announced by whoever raises it. */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const common = "mr-1 flex items-center gap-1.5 text-meta leading-5";
  if (status === "saving") {
    return (
      <p className={`${common} text-foreground-2`}>
        <Spinner size={14} className="border-skeleton-spinner-track border-t-foreground-2" />
        Saving…
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className={`${common} font-semibold text-warning-foreground`}>
        <AlertTriangle aria-hidden="true" className="size-4" />
        Not saved
      </p>
    );
  }
  return (
    <p className={`${common} text-foreground-2`}>
      <Check aria-hidden="true" className="size-4" />
      Saved
    </p>
  );
}
