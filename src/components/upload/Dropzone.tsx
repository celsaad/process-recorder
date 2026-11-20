"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { cn } from "cn";
import type { DropzoneProps } from "@/lib/ui-contracts";
import { ACCEPTED_EXTENSIONS, ACCEPTED_TYPES } from "@/lib/limits";
import { buttonClass, disabledButtonClass } from "@/components/shell/button-styles";

export const LIMITS_TEXT = "MP4, MOV or WebM · best under 3 minutes · up to 10 minutes · 500 MB";
const ACCEPT = [...ACCEPTED_TYPES, ...ACCEPTED_EXTENSIONS].join(",");

/**
 * A real <button> plus a hidden file input (D13). Drag-and-drop on the whole zone is an
 * enhancement. When `disabled`, the button is `aria-disabled` (it keeps focus and explains
 * why), and neither the picker nor a drop does anything.
 */
export function Dropzone({ onFile, disabled = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const depth = useRef(0);
  const hintId = useId();

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    depth.current += 1;
    setDragOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragOver(false);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = disabled ? "none" : "copy";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <section
      aria-label="Upload a recording"
      data-testid="dropzone"
      data-drag-over={dragOver || undefined}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "box-border flex flex-col items-center justify-center gap-3.5 rounded-xl border-2 px-6 py-12 text-center",
        disabled
          ? "border-dashed border-disabled-border bg-disabled"
          : dragOver
            ? "border-solid border-primary bg-info"
            : "border-dashed border-control-border bg-card",
      )}
    >
      {!disabled && (
        <div
          aria-hidden="true"
          className={cn(
            "flex size-12 items-center justify-center rounded-full",
            dragOver ? "bg-primary text-primary-foreground" : "bg-info text-primary",
          )}
        >
          <Upload className="size-6" strokeWidth={1.75} />
        </div>
      )}

      {dragOver ? (
        <p className="text-base font-semibold">Drop the recording to upload it</p>
      ) : (
        <button
          type="button"
          onClick={open}
          aria-disabled={disabled || undefined}
          aria-describedby={hintId}
          className={buttonClass("primary", "lg", disabled ? disabledButtonClass : undefined)}
        >
          Choose a recording
        </button>
      )}

      {disabled ? (
        <p id={hintId} className="text-sm text-foreground-2">
          A recording is already being processed. Cancel it to upload another.
        </p>
      ) : (
        <>
          {!dragOver && <p className="text-sm text-foreground-2">or drop a file here</p>}
          <p id={hintId} className="mt-1.5 text-meta text-muted-foreground">
            {LIMITS_TEXT}
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        tabIndex={-1}
        disabled={disabled}
        data-testid="file-input"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          // Reset so choosing the same file again still fires `change`.
          e.currentTarget.value = "";
          if (file && !disabled) onFile(file);
        }}
      />
    </section>
  );
}
