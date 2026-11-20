"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { ErrorPanelProps } from "@/lib/ui-contracts";
import { ERROR_COPY } from "@/lib/errors";
import { buttonClass } from "@/components/shell/button-styles";

const PRIMARY_LABEL = {
  choose_file: "Choose another file",
  retry: "Retry",
  export: "Export to Word",
} as const;

/**
 * Error panel (D10). Copy comes from ERROR_COPY. The h1 takes focus on mount (and when the
 * error changes), which is how the error is announced: no `role="alert"` (D13).
 * `onSecondary`, when given, renders "Choose another file" next to a Retry primary.
 */
export function ErrorPanel({ error, onPrimary, onSecondary, children }: ErrorPanelProps) {
  const copy = ERROR_COPY[error.kind];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, [error.kind, error.detail]);

  const primary = copy.primaryAction === "none" ? null : copy.primaryAction;
  const showSecondary = onSecondary && primary !== "choose_file";

  return (
    <section
      aria-labelledby={headingId}
      data-error-kind={error.kind}
      className="mx-auto box-border flex w-full max-w-[640px] flex-col gap-4 rounded-xl border border-border bg-card p-7 max-sm:p-5"
    >
      <div
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full bg-danger-bg text-destructive"
      >
        <AlertTriangle className="size-[22px]" strokeWidth={1.9} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-[-0.01em]"
        >
          {copy.title}
        </h1>
        <p className="text-base text-pretty">{copy.body(error.detail)}</p>
      </div>

      {children && (
        <div data-testid="error-detail" className="flex flex-col gap-2.5 text-sm text-pretty text-foreground-2">
          {children}
        </div>
      )}

      {(primary || showSecondary) && (
        <div className="mt-auto flex flex-wrap gap-3 pt-1">
          {primary && (
            <button type="button" className={buttonClass("primary", "lg", primary === "retry" ? "pl-4" : undefined)} onClick={onPrimary}>
              {primary === "retry" && <RotateCw aria-hidden="true" className="size-[18px]" strokeWidth={1.9} />}
              {PRIMARY_LABEL[primary]}
            </button>
          )}
          {showSecondary && (
            <button type="button" className={buttonClass("secondary", "lg", "px-4.5")} onClick={onSecondary}>
              Choose another file
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Grey detail box used inside ErrorPanel's `children` (e.g. "already uploaded", Gemini's reason). */
export function ErrorDetail({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-background px-4 py-3.5 text-sm text-foreground">{children}</div>;
}
