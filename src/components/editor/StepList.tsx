"use client";

import { Plus } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { useAnnounce } from "@/components/shell/LiveRegion";
import { Button } from "@/components/ui/button";
import type { StepListProps } from "@/lib/ui-contracts";
import { DeletedStepRow } from "./DeletedStepRow";
import { StepCard, stepDomId, type StepPart } from "./StepCard";

type FocusTarget = { kind: "step"; id: string; part: StepPart } | { kind: "undo" } | { kind: "addEnd" };

const addButton =
  "h-8 gap-1 rounded-lg pr-2.5 pl-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground";

/**
 * The editable step list (D12). Focus is moved deliberately after every structural change:
 * move → the same Move button; delete → Undo in the inline row; undo → the restored heading;
 * dismiss → the next step's heading (the previous one if the deleted step was last).
 */
export function StepList({ steps, lastDeleted, shotUrls, dispatch, onPickFrame, onAddStep }: StepListProps) {
  const announce = useAnnounce();
  const listRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const root = listRef.current;
    if (!root) return;
    const el =
      target.kind === "step"
        ? document.getElementById(stepDomId(target.id, target.part))
        : target.kind === "undo"
          ? root.querySelector<HTMLElement>("[data-undo]")
          : root.querySelector<HTMLElement>("[data-add-end]");
    el?.focus();
  });

  const neighbourFocus = (index: number, remaining = steps): FocusTarget => {
    const next = remaining[index] ?? remaining[index - 1];
    return next ? { kind: "step", id: next.id, part: "heading" } : { kind: "addEnd" };
  };

  const move = (id: string, index: number, direction: "up" | "down") => {
    const to = direction === "up" ? index - 1 : index + 1;
    if (to < 0 || to >= steps.length) return;
    dispatch({ type: "move", id, direction });
    pendingFocus.current = { kind: "step", id, part: direction };
    announce(`Step moved to position ${to + 1}`);
  };

  const remove = (id: string, index: number) => {
    dispatch({ type: "remove", id });
    pendingFocus.current = { kind: "undo" };
    announce(`Step ${index + 1} deleted`);
  };

  const undo = () => {
    if (!lastDeleted) return;
    dispatch({ type: "undoRemove" });
    pendingFocus.current = { kind: "step", id: lastDeleted.step.id, part: "heading" };
    announce(`Step ${Math.min(lastDeleted.index, steps.length) + 1} restored`);
  };

  const dismiss = () => {
    if (!lastDeleted) return;
    dispatch({ type: "dismissUndo" });
    pendingFocus.current = neighbourFocus(lastDeleted.index);
  };

  const deletedAt = lastDeleted ? Math.min(lastDeleted.index, steps.length) : -1;
  const deletedRow = lastDeleted && (
    <li key={`deleted-${lastDeleted.step.id}`} className="flex flex-col gap-1 pb-3">
      <DeletedStepRow deleted={lastDeleted} onUndo={undo} onDismiss={dismiss} />
    </li>
  );

  return (
    <section ref={listRef} aria-labelledby="steps-heading" className="flex flex-col gap-3">
      <h2 id="steps-heading" className="m-0 text-base font-semibold">
        Steps <span className="font-normal text-muted-foreground">· {steps.length}</span>
      </h2>

      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {steps.map((step, index) => (
          <Fragment key={step.id}>
            {index === deletedAt && deletedRow}
            <li className="flex flex-col gap-1">
              <StepCard
                step={step}
                index={index}
                total={steps.length}
                shotUrl={shotUrls[step.id]}
                onChange={(patch) => dispatch({ type: "update", id: step.id, patch })}
                onMove={(direction) => move(step.id, index, direction)}
                onDelete={() => remove(step.id, index)}
                onPickFrame={() => onPickFrame(step.id)}
                onHighlightChange={(highlight, source) =>
                  dispatch({ type: "setHighlight", id: step.id, highlight, source })
                }
              />
              {index < steps.length - 1 && (
                <div className="flex h-8 items-center gap-3">
                  <div aria-hidden="true" className="h-px grow bg-border" />
                  <Button type="button" variant="ghost" onClick={() => onAddStep(step.id)} className={addButton}>
                    <Plus aria-hidden="true" />
                    <span>
                      Add step <span className="sr-only">after step {index + 1}</span>
                    </span>
                  </Button>
                  <div aria-hidden="true" className="h-px grow bg-border" />
                </div>
              )}
            </li>
          </Fragment>
        ))}
        {deletedAt === steps.length && deletedRow}
      </ol>

      <Button
        type="button"
        variant="ghost"
        data-add-end=""
        onClick={() => onAddStep(steps.at(-1)?.id ?? null)}
        className="mt-2 h-11 gap-2 rounded-xl border border-dashed border-control-border text-sm font-semibold"
      >
        <Plus aria-hidden="true" className="size-[18px]" />
        <span>
          Add step <span className="sr-only">at the end</span>
        </span>
      </Button>
    </section>
  );
}
