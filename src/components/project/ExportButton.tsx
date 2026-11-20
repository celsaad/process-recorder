"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { ExportButtonProps } from "@/lib/ui-contracts";
import { useAnnounce } from "@/components/shell/LiveRegion";
import { buttonClass } from "@/components/shell/button-styles";
import { Spinner } from "@/components/shell/Spinner";

export const EXPORT_TOAST_ID = "export-failed";

/**
 * "Export to Word" with a busy state. While busy the button is `aria-disabled` (it keeps focus)
 * and ignores clicks. On failure: an "Export failed" toast whose "Try again" takes focus
 * (StatesEditor board); Dismiss or Try again puts focus back on this button.
 */
export function ExportButton({ onExport }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const announce = useAnnounce();

  useEffect(() => () => void toast.dismiss(EXPORT_TOAST_ID), []);

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    toast.dismiss(EXPORT_TOAST_ID);
    try {
      await onExport();
    } catch {
      announce("Export failed");
      toast.custom(
        (id) => (
          <ExportFailedToast
            onRetry={() => {
              toast.dismiss(id);
              buttonRef.current?.focus();
              void run();
            }}
            onDismiss={() => {
              toast.dismiss(id);
              buttonRef.current?.focus();
            }}
          />
        ),
        { id: EXPORT_TOAST_ID, duration: Infinity },
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
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
  );
}

export function ExportFailedToast({ onRetry, onDismiss }: { onRetry: () => void; onDismiss: () => void }) {
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    retryRef.current?.focus();
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-toast py-1.5 pr-1.5 pl-5 text-toast-foreground shadow-[0_8px_24px_rgba(21,24,28,0.28)]">
      <p className="mr-3 text-sm">
        <strong className="font-semibold">Export failed.</strong> The Word file couldn&apos;t be created. Your steps
        are unchanged.
      </p>
      <button
        ref={retryRef}
        type="button"
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
