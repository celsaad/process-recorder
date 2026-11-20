"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MIN_RECT, clampRect, moveRect, resizeRect } from "@/lib/geometry";
import type { Rect } from "@/lib/types";
import type { HighlightEditorProps } from "@/lib/ui-contracts";
import { cn } from "@/lib/utils";

type Corner = "nw" | "ne" | "sw" | "se";
type DragMode = "move" | Corner;

const KEY_HINT = "Arrow keys move. Shift + arrows move 10 times further. Alt + arrows resize. Delete removes.";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Drags one corner; the opposite corner stays put. Never smaller than MIN_RECT or outside the image. */
export function resizeFromCorner(r: Rect, corner: Corner, dx: number, dy: number): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (corner === "nw" || corner === "sw") left = Math.min(clamp01(left + dx), right - MIN_RECT);
  else right = Math.max(clamp01(right + dx), left + MIN_RECT);
  if (corner === "nw" || corner === "ne") top = Math.min(clamp01(top + dy), bottom - MIN_RECT);
  else bottom = Math.max(clamp01(bottom + dy), top + MIN_RECT);
  return clampRect({ x: left, y: top, w: right - left, h: bottom - top });
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const pct = (v: number) => `${v * 100}%`;

const CORNERS: { corner: Corner; className: string }[] = [
  { corner: "nw", className: "-left-3.5 -top-3.5 cursor-nwse-resize" },
  { corner: "ne", className: "-right-3.5 -top-3.5 cursor-nesw-resize" },
  { corner: "sw", className: "-left-3.5 -bottom-3.5 cursor-nesw-resize" },
  { corner: "se", className: "-right-3.5 -bottom-3.5 cursor-nwse-resize" },
];

/**
 * The step screenshot with its highlight drawn on top, edited in place (D9).
 * Pointer drags update a local draft once per animation frame and commit on pointer-up.
 */
export function HighlightEditor({ imageUrl, alt, stepNumber, highlight, suggested, onChange }: HighlightEditorProps) {
  const hintId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<HTMLButtonElement>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const drag = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    start: Rect;
    width: number;
    height: number;
    latest: Rect;
    frame: number | null;
  } | null>(null);

  useEffect(
    () => () => {
      if (drag.current?.frame != null) cancelAnimationFrame(drag.current.frame);
    },
    [],
  );

  const shown = draft ?? highlight;

  function beginDrag(e: PointerEvent<HTMLElement>, mode: DragMode) {
    if (!highlight || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    rectRef.current?.focus();
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    rectRef.current?.setPointerCapture?.(e.pointerId);
    drag.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: highlight,
      width: box.width,
      height: box.height,
      latest: highlight,
      frame: null,
    };
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.width;
    const dy = (e.clientY - d.startY) / d.height;
    d.latest = d.mode === "move" ? moveRect(d.start, dx, dy) : resizeFromCorner(d.start, d.mode, dx, dy);
    if (d.frame == null) {
      d.frame = requestAnimationFrame(() => {
        d.frame = null;
        setDraft(d.latest);
      });
    }
  }

  function endDrag(commit: boolean) {
    const d = drag.current;
    if (!d) return;
    if (d.frame != null) cancelAnimationFrame(d.frame);
    drag.current = null;
    setDraft(null);
    if (commit && !sameRect(d.latest, d.start)) onChange(d.latest);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!highlight) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onChange(null);
      return;
    }
    const step = e.shiftKey ? 0.1 : 0.01;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    onChange(e.altKey ? resizeRect(highlight, d[0], d[1]) : moveRect(highlight, d[0], d[1]));
  }

  const active = focused || draft !== null;
  const isSuggestion = sameRect(highlight, suggested);

  return (
    <div className="flex flex-col gap-2">
      <div ref={frameRef} className="relative mx-auto w-fit max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- object URLs from IndexedDB, not optimisable by next/image */}
        <img
          src={imageUrl}
          alt={alt}
          draggable={false}
          className="block h-auto max-h-80 w-auto max-w-full rounded-lg border border-control-border bg-muted select-none"
        />
        {shown && (
          <div
            className="absolute"
            style={{ left: pct(shown.x), top: pct(shown.y), width: pct(shown.w), height: pct(shown.h) }}
          >
            <button
              ref={rectRef}
              type="button"
              data-highlight-rect=""
              aria-label={`Highlight on step ${stepNumber} screenshot`}
              aria-describedby={hintId}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              onPointerDown={(e) => beginDrag(e, "move")}
              onPointerMove={onPointerMove}
              onPointerUp={() => endDrag(true)}
              onPointerCancel={() => endDrag(false)}
              onLostPointerCapture={() => endDrag(true)}
              className={cn(
                "absolute inset-0 size-full cursor-move touch-none rounded p-0",
                active && "bg-highlight/5 shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--ring)]",
              )}
            >
              <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible" preserveAspectRatio="none">
                <rect
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  rx="4"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="7"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  rx="4"
                  fill="none"
                  stroke="var(--highlight)"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {active &&
                CORNERS.map(({ corner, className }) => (
                  <span
                    key={corner}
                    aria-hidden="true"
                    data-handle={corner}
                    onPointerDown={(e) => beginDrag(e, corner)}
                    className={cn("absolute flex size-6 items-center justify-center", className)}
                  >
                    <span className="size-3.5 rounded border-2 border-highlight bg-white" />
                  </span>
                ))}
            </button>
            {isSuggestion && !active && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -left-[3px] top-[calc(100%+5px)] rounded bg-highlight px-1.5 text-xs leading-[18px] font-semibold whitespace-nowrap text-white"
              >
                Suggested
              </span>
            )}
          </div>
        )}
      </div>
      {highlight && (
        <p id={hintId} className={cn("m-0 text-[13px] leading-[18px] text-muted-foreground", !active && "sr-only")}>
          {KEY_HINT}
        </p>
      )}
    </div>
  );
}
