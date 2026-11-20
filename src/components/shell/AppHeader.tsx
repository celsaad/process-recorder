"use client";

import { useEffect, useRef, type RefObject } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { AppHeaderProps } from "@/lib/ui-contracts";
import type { SaveStatus } from "@/lib/types";
import { buttonClass } from "./button-styles";
import { Spinner } from "./Spinner";

/** Set on <html> from the header's real height; globals.css derives `scroll-padding-top` from it. */
export const HEADER_HEIGHT_VAR = "--header-height";

/**
 * Keeps `--header-height` equal to the sticky header's rendered height, which grows when it
 * wraps (≈640–870 px wide), so focused elements never scroll in under it (WCAG 2.4.11).
 */
function useHeaderHeightVar(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => root.style.setProperty(HEADER_HEIGHT_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEADER_HEIGHT_VAR);
    };
  }, [ref]);
}

/**
 * App header. Sticky, so Export and the save status stay visible with 20+ steps.
 * `title` goes on the left, after the brand, and switches the header to editor mode;
 * `actions` go at the far right, after the save status and "Start new" (EditorHeader board).
 */
export function AppHeader({ saveStatus, onStartNew, title, actions }: AppHeaderProps) {
  const ref = useRef<HTMLElement>(null);
  useHeaderHeightVar(ref);
  const inEditor = title != null;

  return (
    <header
      ref={ref}
      className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border bg-card px-[clamp(16px,4vw,32px)] py-2.5"
    >
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
          {actions}
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
