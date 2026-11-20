"use client";

import { useLayoutEffect, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConfirmDialogProps, ConfirmKind } from "@/lib/ui-contracts";
import { buttonClass } from "@/components/shell/button-styles";

export const CONFIRM_COPY: Record<ConfirmKind, { title: string; body: string; cancel: string; confirm: string }> = {
  start_new: {
    title: "Start new?",
    body: "This deletes the current test script and its screenshots from this browser, and the recording held by Gemini. Export to Word first if you want to keep it.",
    cancel: "Cancel",
    confirm: "Delete and start new",
  },
  replace: {
    title: "Replace current project?",
    body: "Processing the new recording deletes the current test script and its screenshots from this browser. Export to Word first if you want to keep it.",
    cancel: "Keep current project",
    confirm: "Replace",
  },
};

/**
 * Destructive confirm (Dialogs board). Radix alert-dialog: focus is trapped, starts on the
 * safe button, Esc resolves `false`, and focus returns to whatever was focused before it opened.
 * (Radix only restores focus to its own Trigger; this dialog is opened by state, so we keep
 * the previously focused element ourselves.)
 */
export function ConfirmDialog({ open, kind, onResolve }: ConfirmDialogProps) {
  const copy = CONFIRM_COPY[kind];
  const returnTo = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnTo.current = document.activeElement;
    }
  }, [open]);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onResolve(false);
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const target = returnTo.current;
          returnTo.current = null;
          if (target?.isConnected) target.focus();
        }}
        className="flex max-w-[460px] flex-col gap-5 rounded-xl p-6 ring-0 shadow-[0_24px_64px_rgba(21,24,28,0.4)] data-[size=default]:max-w-[calc(100%-32px)] data-[size=default]:sm:max-w-[460px]">
        <div className="flex flex-col gap-2">
          <AlertDialogTitle className="text-xl font-semibold tracking-[-0.01em]">{copy.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-pretty text-foreground-2">{copy.body}</AlertDialogDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <AlertDialogCancel className={buttonClass("secondary", "lg", "px-4.5")}>{copy.cancel}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonClass("danger", "lg")}
            onClick={(e) => {
              // Keep Radix from also firing onOpenChange(false); the parent closes the dialog.
              e.preventDefault();
              onResolve(true);
            }}
          >
            {copy.confirm}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
