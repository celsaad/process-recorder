"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import { RESULTS_HEADING_ID, type ProjectTitleProps } from "@/lib/ui-contracts";
import { buttonClass } from "@/components/shell/button-styles";

/**
 * The visible h1 (focus target after capture, D13) plus a "Rename" icon button that swaps in
 * a labelled input. Enter or Done saves, Esc cancels; focus then returns to Rename.
 * An empty title is not saved.
 */
export function ProjectTitle({ value, onChange }: ProjectTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const inputId = useId();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      renameRef.current?.focus();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
  };
  const finish = (save: boolean) => {
    const next = draft.trim();
    if (save && next && next !== value) onChange(next);
    returnFocus.current = true;
    setEditing(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="text-meta font-semibold text-foreground-2">
          Process title
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          className="box-border h-10 w-[340px] max-w-full rounded-lg border border-control-border bg-card px-3 text-base font-semibold text-foreground"
        />
        <button type="button" className={buttonClass("secondary", "md", "ml-1")} onClick={() => finish(true)}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <h1
        id={RESULTS_HEADING_ID}
        tabIndex={-1}
        className="text-xl font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]"
      >
        {value}
      </h1>
      <button
        ref={renameRef}
        type="button"
        aria-label="Rename process"
        onClick={startEditing}
        className={buttonClass("secondary", "icon")}
      >
        <Pencil aria-hidden="true" className="size-4" strokeWidth={1.9} />
      </button>
    </div>
  );
}
