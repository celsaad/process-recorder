"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { ExportButtonProps } from "@/lib/ui-contracts";
import { buttonClass } from "@/components/shell/button-styles";
import { Spinner } from "@/components/shell/Spinner";

/**
 * "Export to Word" with a busy state. While busy the button is `aria-disabled` (it keeps focus)
 * and ignores clicks. On failure: an "Export failed" toast whose "Try again" takes focus
 * (StatesEditor board); Dismiss or Try again puts focus back on this button.
 *
 * The toast is our own fixed-position element, not a sonner toast: sonner's container is a
 * second `aria-live` region, and the app has exactly one (D13). It isn't live either. Focus
 * moving to "Try again" announces it, with the message as the button's description.
 * It sits right after this button in the DOM, so Tab reaches it from here (not last on the page).
 */
export function ExportButton({ onExport }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const busyRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await onExport();
    } catch {
      setFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const closeToast = () => {
    setFailed(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-disabled={busy || undefined}
        onClick={() => void run()}
        className={buttonClass("primary", "lg", busy ? "cursor-progress pr-4.5 pl-3.5" : "pr-4.5 pl-3.5")}
      >
        {busy ? (
          <>
            <Spinner size={16} className="border-white/45 border-t-primary-foreground" />
            Exporting…
          </>
        ) : (
          <>
            <Download aria-hidden="true" className="size-[18px]" strokeWidth={1.9} />
            Export to Word
          </>
        )}
      </button>
      {failed && (
        <div className="fixed bottom-6 left-1/2 z-50 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          <ExportFailedToast
            onRetry={() => {
              closeToast();
              void run();
            }}
            onDismiss={closeToast}
          />
        </div>
      )}
    </>
  );
}

export function ExportFailedToast({ onRetry, onDismiss }: { onRetry: () => void; onDismiss: () => void }) {
  const retryRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();
  useEffect(() => {
    retryRef.current?.focus();
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-toast py-1.5 pr-1.5 pl-5 text-toast-foreground shadow-[0_8px_24px_rgba(21,24,28,0.28)]">
      <p id={messageId} className="mr-3 text-sm">
        <strong className="font-semibold">Export failed.</strong> The Word file couldn&apos;t be created. Your steps
        are unchanged.
      </p>
      <button
        ref={retryRef}
        type="button"
        aria-describedby={messageId}
        onClick={onRetry}
        className={buttonClass("secondary", "lg", "border-toast-foreground bg-transparent px-4 text-toast-foreground hover:bg-white/10")}
      >
        Try again
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className={buttonClass("ghost", "lg", "ml-1 px-3.5 text-toast-foreground hover:bg-white/10 hover:text-toast-foreground")}
      >
        Dismiss
      </button>
    </div>
  );
}
