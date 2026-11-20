"use client";

import { ArrowDown, ArrowUp, Clock, Image as ImageIcon, ImageOff, Plus, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { HighlightEditor } from "@/components/highlight/HighlightEditor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/lib/timestamp";
import type { Rect } from "@/lib/types";
import type { StepCardProps } from "@/lib/ui-contracts";
import { cn } from "@/lib/utils";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

export type StepPart = "heading" | "up" | "down";

/** DOM id of a card element, used by StepList to move focus (D12). */
export const stepDomId = (stepId: string, part: StepPart | "action" | "description" | "expected") =>
  `step-${stepId}-${part}`;

/** Where "Add highlight" puts a new box when there's no suggestion: centred, 30% × 20%. */
const DEFAULT_HIGHLIGHT: Rect = { x: 0.35, y: 0.4, w: 0.3, h: 0.2 };

const sameRect = (a: Rect | null, b: Rect | null) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const textButton =
  "h-10 gap-2 rounded-lg px-3 text-sm font-semibold [&_svg:not([class*='size-'])]:size-[18px]";
const iconButton =
  "size-10 rounded-lg border-control-border [&_svg:not([class*='size-'])]:size-[18px] aria-disabled:cursor-not-allowed aria-disabled:border-border aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:hover:bg-muted";

/** Visible text, then the rest of the accessible name for screen readers (label-in-name, WCAG 2.5.3). */
function Named({ visible, rest }: { visible: ReactNode; rest: string }) {
  return (
    <span>
      {visible} <span className="sr-only">{rest}</span>
    </span>
  );
}

export function StepCard({
  step,
  index,
  total,
  shotUrl,
  onChange,
  onMove,
  onDelete,
  onPickFrame,
  onHighlightChange,
}: StepCardProps) {
  const n = index + 1;
  const time = formatTimestamp(step.timestampSec);
  const cardRef = useRef<HTMLElement>(null);
  // After a highlight button removes itself (Reset, overlay Delete), focus moves deliberately.
  const focusNext = useRef<"rect" | "toggle" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const sel = target === "rect" ? "[data-highlight-rect]" : "[data-highlight-toggle]";
    cardRef.current?.querySelector<HTMLElement>(sel)?.focus();
  });

  const pending = step.captureState === "pending" || (step.captureState === "ok" && !shotUrl);
  const failed = step.captureState === "failed";
  const ready = !pending && !failed && !!shotUrl;
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const canReset = ready && !!step.suggestedHighlight && !sameRect(step.highlight, step.suggestedHighlight);

  const pickFrame = () => {
    if (!pending) onPickFrame();
  };

  const field = (part: "action" | "description" | "expected", label: string, minRows: string) => {
    const key = part === "expected" ? "expectedResult" : part;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={stepDomId(step.id, part)} className="text-[13px] leading-[18px] font-semibold text-muted-foreground">
          {label}
        </Label>
        <AutoGrowTextarea
          id={stepDomId(step.id, part)}
          value={step[key]}
          rows={part === "action" ? 1 : 2}
          onChange={(e) => onChange({ [key]: e.target.value })}
          className={cn(
            "rounded-lg border-control-border bg-card px-3 py-[11px] text-sm leading-5 md:text-sm",
            minRows,
            part === "action" && "font-medium",
          )}
        />
      </div>
    );
  };

  return (
    <article
      ref={cardRef}
      aria-labelledby={stepDomId(step.id, "heading")}
      className="flex w-full flex-col gap-4 rounded-xl border border-border bg-card px-6 py-5 text-sm text-card-foreground"
    >
      <div className="flex items-center gap-3">
        <h3 id={stepDomId(step.id, "heading")} tabIndex={-1} className="m-0 text-base font-semibold">
          Step {n}
        </h3>
        <Button
          type="button"
          variant="outline"
          aria-label={`${time}, pick frame for step ${n}`}
          aria-disabled={pending || undefined}
          onClick={pickFrame}
          className="h-8 gap-1.5 border-control-border pr-3 pl-2 text-[13px] font-medium tabular-nums aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground"
        >
          <Clock aria-hidden="true" />
          {time}
        </Button>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
          {field("action", "Action", "min-h-11")}
          {field("description", "Description", "min-h-16")}
          {field("expected", "Expected result", "min-h-16")}
        </div>

        <div className="flex min-w-0 max-w-[500px] flex-[1_1_420px] flex-col gap-2">
          {ready && (
            <HighlightEditor
              imageUrl={shotUrl!}
              alt={`Screenshot for step ${n}`}
              stepNumber={n}
              highlight={step.highlight}
              suggested={step.suggestedHighlight}
              onChange={(r) => {
                if (!r) focusNext.current = "toggle";
                onHighlightChange(r, r ? "user" : null);
              }}
            />
          )}
          {pending && (
            <Skeleton
              data-testid="shot-skeleton"
              className="flex aspect-[16/10] max-h-80 flex-col items-center justify-center gap-2.5 rounded-lg border border-border"
            >
              <span
                aria-hidden="true"
                className="size-6 animate-spin rounded-full border-[3px] border-control-border/40 border-t-muted-foreground"
              />
              <p className="m-0 text-[13px] leading-[18px] font-medium text-muted-foreground">
                {step.captureState === "pending" ? `Capturing screenshot at ${time}` : "Loading screenshot"}
              </p>
            </Skeleton>
          )}
          {failed && (
            <div className="flex aspect-[16/10] max-h-80 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-control-border bg-background p-4 text-center">
              <ImageOff aria-hidden="true" className="size-7 text-muted-foreground" />
              <div className="flex flex-col gap-0.5">
                <p className="m-0 text-sm font-semibold">No screenshot for this step</p>
                <p className="m-0 text-[13px] leading-[18px] text-muted-foreground">
                  The frame at {time} couldn&apos;t be captured.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={onPickFrame} className={cn(textButton, "border-control-border")}>
                <ImageIcon aria-hidden="true" />
                Pick frame for step {n}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-muted pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {!failed && (
            <Button
              type="button"
              variant="outline"
              aria-disabled={pending || undefined}
              onClick={pickFrame}
              className={cn(
                textButton,
                "border-control-border aria-disabled:cursor-not-allowed aria-disabled:border-border aria-disabled:bg-muted aria-disabled:text-muted-foreground",
              )}
            >
              <ImageIcon aria-hidden="true" />
              <Named visible="Pick frame" rest={`for step ${n}`} />
            </Button>
          )}
          {ready && (
            // One element for Add and Remove, so focus stays on it when it toggles.
            <Button
              type="button"
              variant="ghost"
              data-highlight-toggle=""
              onClick={() =>
                step.highlight
                  ? onHighlightChange(null, null)
                  : onHighlightChange(DEFAULT_HIGHLIGHT, "user")
              }
              className={textButton}
            >
              {step.highlight ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
              <Named visible={step.highlight ? "Remove highlight" : "Add highlight"} rest={`for step ${n}`} />
            </Button>
          )}
          {canReset && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                focusNext.current = "rect";
                onHighlightChange(step.suggestedHighlight, "gemini");
              }}
              className={textButton}
            >
              <Undo2 aria-hidden="true" />
              <Named visible="Reset to suggestion" rest={`for step ${n}`} />
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            id={stepDomId(step.id, "up")}
            aria-label={`Move step ${n} up`}
            aria-disabled={isFirst || undefined}
            onClick={() => !isFirst && onMove("up")}
            className={iconButton}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            id={stepDomId(step.id, "down")}
            aria-label={`Move step ${n} down`}
            aria-disabled={isLast || undefined}
            onClick={() => !isLast && onMove("down")}
            className={iconButton}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label={`Delete step ${n}`}
            onClick={onDelete}
            className={iconButton}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
    </article>
  );
}
