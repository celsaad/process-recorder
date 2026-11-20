"use client";

import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeletedStepRowProps } from "@/lib/ui-contracts";

/** Inline "Step N deleted · Undo · Dismiss" where the card was. No timeout (WCAG 2.2.1, D12). */
export function DeletedStepRow({ deleted, onUndo, onDismiss }: DeletedStepRowProps) {
  const action = deleted.step.action.trim();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-dashed border-control-border bg-card py-2 pr-2 pl-6">
      <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
        <span className="font-semibold">Step {deleted.index + 1} deleted</span>
        {action && <span className="text-muted-foreground">{action}</span>}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          data-undo=""
          onClick={onUndo}
          className="h-11 gap-2 border-control-border pr-4 pl-3 text-sm font-semibold"
        >
          <Undo2 aria-hidden="true" className="size-[18px]" />
          Undo
        </Button>
        <Button type="button" variant="ghost" onClick={onDismiss} className="h-11 px-3.5 text-sm font-semibold">
          Dismiss
        </Button>
      </div>
    </div>
  );
}
