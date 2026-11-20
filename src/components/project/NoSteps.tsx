"use client";

import { useEffect, useRef } from "react";
import { List, Plus } from "lucide-react";
import type { NoStepsProps } from "@/lib/ui-contracts";
import { buttonClass } from "@/components/shell/button-styles";

/**
 * Gemini returned no steps (D10 `no_steps`). The heading takes focus on mount (UX.md).
 * It's an h2: the editor header's ProjectTitle is the page's h1.
 */
export function NoSteps({ onAddStep }: NoStepsProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="no-steps-heading"
      className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center"
    >
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full border border-control-border bg-card text-foreground-2"
      >
        <List className="size-6" strokeWidth={1.75} />
      </div>
      <div className="flex max-w-[520px] flex-col gap-2">
        <h2 id="no-steps-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-[-0.015em]">
          No steps found
        </h2>
        <p className="text-base text-pretty text-foreground-2">
          Gemini watched the recording and didn&apos;t find distinct actions to write up. This can happen when little
          changes on screen.
        </p>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button type="button" className={buttonClass("primary", "lg", "pl-4")} onClick={onAddStep}>
          <Plus aria-hidden="true" className="size-[18px]" strokeWidth={1.9} />
          Add a step manually
        </button>
      </div>
    </section>
  );
}
