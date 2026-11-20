"use client";

import type { EmptyStateProps } from "@/lib/ui-contracts";
import { Dropzone } from "./Dropzone";

const HOW_IT_WORKS = [
  { title: "Upload a recording", body: "Record one process from start to finish, in a single window." },
  {
    title: "Review the steps",
    body: "Each step has an action, a description, an expected result and a screenshot. Edit any of them.",
  },
  { title: "Export to Word", body: "Download a .docx test script with a table of steps and screenshots." },
];

/** First-visit screen (UX.md "Empty"). Rendered inside the page's <main>; it has no landmark of its own. */
export function EmptyState({ onFile }: EmptyStateProps) {
  return (
    <div className="mx-auto box-border flex w-full max-w-[880px] flex-col gap-10 px-[clamp(16px,4vw,32px)] pt-14 pb-12">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-balance">
          Turn a screen recording into a test script
        </h1>
        <p className="max-w-[620px] text-base text-pretty text-foreground-2">
          Upload a short recording of a process. You get numbered steps with screenshots that you can edit and export
          to Word.
        </p>
      </div>

      <Dropzone onFile={onFile} />

      <section aria-labelledby="how-heading" className="flex flex-col gap-4">
        <h2 id="how-heading" className="text-meta font-semibold text-foreground-2">
          How it works
        </h2>
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-6">
          {HOW_IT_WORKS.map((item, i) => (
            <li key={item.title} className="flex items-start gap-3">
              <div
                aria-hidden="true"
                className="box-border flex size-7 shrink-0 items-center justify-center rounded-full border border-control-border text-meta font-semibold"
              >
                {i + 1}
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="pt-1 text-sm font-semibold">{item.title}</h3>
                <p className="text-sm text-pretty text-foreground-2">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="border-t border-border pt-5 text-meta leading-5 text-pretty text-muted-foreground">
        Recordings are sent to Google Gemini for analysis. Steps and screenshots are saved in this browser only. Start
        new deletes them, along with the copy held by Gemini.
      </p>
    </div>
  );
}
