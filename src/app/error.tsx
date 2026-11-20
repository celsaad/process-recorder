"use client"; // Error boundaries must be Client Components

import { useEffect, useRef } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { buttonClass } from "@/components/shell/button-styles";

/**
 * Crash page (D10, StatesUpload board). "Reload" does a full reload: the project lives in
 * IndexedDB and survives it, whereas `retry()` would re-render the same broken state.
 */
export default function ErrorPage({ error }: { error: unknown; retry: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(error);
    headingRef.current?.focus();
  }, [error]);

  return (
    <main className="mx-auto box-border w-full max-w-[640px] flex-1 px-[clamp(16px,4vw,32px)] py-14">
      <section
        aria-labelledby="crash-heading"
        className="box-border flex flex-col gap-4 rounded-xl border border-border bg-card p-7 max-sm:p-5"
      >
        <div
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-full bg-danger-bg text-destructive"
        >
          <AlertTriangle className="size-[22px]" strokeWidth={1.9} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 id="crash-heading" ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-[-0.01em]">
            Something went wrong
          </h1>
          <p className="text-base text-pretty">The page hit an unexpected error and had to stop.</p>
        </div>
        <p className="text-sm text-pretty text-foreground-2">
          Your test script is saved in this browser and will be here after you reload.
        </p>
        <div className="mt-auto flex flex-wrap gap-3 pt-1">
          <button type="button" className={buttonClass("primary", "lg", "pl-4")} onClick={() => window.location.reload()}>
            <RotateCw aria-hidden="true" className="size-[18px]" strokeWidth={1.9} />
            Reload
          </button>
        </div>
      </section>
    </main>
  );
}
