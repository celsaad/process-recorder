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
import { RESULTS_HEADING_ID, type ConfirmDialogProps, type ConfirmKind } from "@/lib/ui-contracts";
import { buttonClass } from "@/components/shell/button-styles";

type CopyArgs = { projectTitle?: string; fileName?: string };

const quoted = (title?: string) => (title?.trim() ? `“${title.trim()}”` : null);

export const CONFIRM_COPY: Record<
  ConfirmKind,
  { title: string; body: (args: CopyArgs) => string; cancel: string; confirm: string }
> = {
  start_new: {
    title: "Start new?",
    body: ({ projectTitle }) =>
      `This deletes ${quoted(projectTitle) ?? "the current test script"} and its screenshots from this browser, and the recording held by Gemini. Export to Word first if you want to keep it.`,
    cancel: "Cancel",
    confirm: "Delete and start new",
  },
  replace: {
    title: "Replace current project?",
    body: ({ projectTitle, fileName }) =>
      `${fileName ? `Processing ${quoted(fileName)}` : "Processing the new recording"} deletes ${quoted(projectTitle) ?? "the current test script"} and its screenshots from this browser. Export to Word first if you want to keep it.`,
    cancel: "Keep current project",
    confirm: "Replace",
  },
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** When the opener is unknown (Safari/Firefox don't focus on click; "replace" opens from a drop)
 *  or gone: the results heading, else the first focusable element in <main>. */
function fallbackFocusTarget(): HTMLElement | null {
  return (
    document.getElementById(RESULTS_HEADING_ID) ?? document.querySelector<HTMLElement>(`main :is(${FOCUSABLE})`)
  );
}

/**
 * Destructive confirm (Dialogs board). Radix alert-dialog: focus is trapped, starts on the
 * safe button, Esc resolves `false`, and focus returns to whatever was focused before it opened.
 * (Radix only restores focus to its own Trigger; this dialog is opened by state, so we keep
 * the previously focused element ourselves, with a fallback when there was none.)
 */
export function ConfirmDialog({ open, kind, onResolve, projectTitle, fileName }: ConfirmDialogProps) {
  const copy = CONFIRM_COPY[kind];
  const returnTo = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    returnTo.current = null;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
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
          (target?.isConnected ? target : fallbackFocusTarget())?.focus();
        }}
        className="flex max-w-[460px] flex-col gap-5 rounded-xl p-6 ring-0 shadow-[0_24px_64px_rgba(21,24,28,0.4)] data-[size=default]:max-w-[calc(100%-32px)] data-[size=default]:sm:max-w-[460px]">
        <div className="flex flex-col gap-2">
          <AlertDialogTitle className="text-xl font-semibold tracking-[-0.01em]">{copy.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-pretty [overflow-wrap:anywhere] text-foreground-2">
            {copy.body({ projectTitle, fileName })}
          </AlertDialogDescription>
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
