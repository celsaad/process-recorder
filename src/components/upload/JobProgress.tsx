"use client";

import { useEffect, useState } from "react";
import { Check, Video } from "lucide-react";
import type { JobProgressProps } from "@/lib/ui-contracts";
import type { JobStage } from "@/lib/types";
import { isLongVideo } from "@/lib/limits";
import { formatBytes, formatTimestamp } from "@/lib/timestamp";
import { Banner } from "@/components/feedback/Banner";
import { buttonClass } from "@/components/shell/button-styles";
import { Spinner } from "@/components/shell/Spinner";

type ListedStage = Exclude<JobStage, "validating">;

export const STAGES: { stage: ListedStage; label: string; detail: string }[] = [
  { stage: "received", label: "Receiving", detail: "The local server is receiving the video." },
  { stage: "sending_to_gemini", label: "Sending to Gemini", detail: "Uploading the video to Gemini." },
  { stage: "gemini_processing", label: "Gemini processing", detail: "Gemini is preparing the video for analysis." },
  { stage: "analyzing", label: "Analyzing", detail: "Gemini is watching the recording and writing the steps." },
  { stage: "capturing", label: "Screenshots", detail: "Capturing a screenshot for each step." },
];

export function longVideoNotice(durationSec: number): string {
  return `This recording is ${formatTimestamp(durationSec)}. Longer recordings take longer to process and are more likely to miss steps. Check the list carefully.`;
}

/** Seconds since `startedAt`, ticking once a second. Visual only: never announced (UX.md). */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Reset in a timeout (not synchronously) so a new stage starts at 0:00 without a cascading render.
    const reset = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(reset);
      clearInterval(id);
    };
  }, [startedAt]);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/**
 * The progress screen (UX.md "Uploading" / "Analyzing"). Visual only: the orchestrator hook
 * announces stage changes, so this component never calls `useAnnounce`. Every stage carries
 * a text state (Done / In progress / Waiting), so nothing relies on colour alone.
 */
export function JobProgress({ job, video, onCancel }: JobProgressProps) {
  const elapsed = useElapsed(job.stageStartedAt);
  const activeIndex = STAGES.findIndex((s) => s.stage === job.stage);

  const statusOf = (stage: ListedStage, i: number): "done" | "active" | "pending" => {
    if (job.completed.includes(stage)) return "done";
    if (i === activeIndex) return "active";
    if (activeIndex !== -1 && i < activeIndex) return "done";
    return "pending";
  };

  return (
    <div className="mx-auto box-border w-full max-w-[640px] px-[clamp(16px,4vw,32px)] pt-18 pb-12">
      <section
        aria-labelledby="progress-heading"
        className="box-border flex flex-col gap-6 rounded-xl border border-border bg-card p-8 max-sm:p-5"
      >
        <div className="flex flex-col gap-4">
          <h1 id="progress-heading" className="text-2xl font-semibold tracking-[-0.015em]">
            {job.stage === "validating" ? "Checking your recording" : "Processing your recording"}
          </h1>
          <div className="flex items-center gap-3 rounded-lg bg-background px-3.5 py-3">
            <Video aria-hidden="true" className="size-5 shrink-0 text-foreground-2" strokeWidth={1.75} />
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">{video.name}</p>
              <p className="text-meta leading-5 text-muted-foreground tabular-nums">
                {formatBytes(video.sizeBytes)}
                {video.durationSec > 0 && ` · ${formatTimestamp(video.durationSec)}`}
              </p>
            </div>
          </div>
          {isLongVideo(video.durationSec) && <Banner tone="info">{longVideoNotice(video.durationSec)}</Banner>}
        </div>

        <div
          role="progressbar"
          aria-label="Processing your recording"
          aria-valuetext={job.stage === "validating" ? "Checking the file" : STAGES[activeIndex]?.label}
          className="relative h-1.5 overflow-hidden rounded-sm bg-border"
        >
          <div className="pr-indeterminate absolute top-0 h-full w-[35%] rounded-sm bg-primary" />
        </div>

        {job.stage === "validating" ? (
          <p className="flex items-center gap-3 text-sm text-foreground-2">
            <Spinner size={22} />
            Format, length and size are checked in your browser before anything is uploaded.
          </p>
        ) : (
          <ol aria-label="Processing stages" className="flex flex-col">
            {STAGES.map((s, i) => {
              const status = statusOf(s.stage, i);
              const last = i === STAGES.length - 1;
              return (
                <li
                  key={s.stage}
                  data-status={status}
                  aria-current={status === "active" ? "step" : undefined}
                  className={`flex gap-3 ${last ? "" : "border-b border-divider-soft"} ${
                    status === "active" ? "items-start py-3" : "min-h-11 items-center"
                  }`}
                >
                  <StageIcon status={status} />
                  {status === "active" ? (
                    <>
                      <div className="flex flex-1 flex-col gap-0.5">
                        <p className="text-base font-semibold">
                          {s.label}
                          <span className="sr-only"> (in progress)</span>
                        </p>
                        <p className="text-meta text-foreground-2">
                          {s.stage === "capturing" && job.capture
                            ? `Screenshot ${Math.min(job.capture.done + 1, job.capture.total)} of ${job.capture.total}.`
                            : s.detail}
                        </p>
                      </div>
                      <p className="text-base font-semibold tabular-nums" data-testid="elapsed">
                        <span className="sr-only">Elapsed </span>
                        {formatTimestamp(elapsed)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="flex-1 text-sm text-foreground-2">{s.label}</p>
                      <p className="text-meta leading-5 text-muted-foreground">
                        {status === "done" ? "Done" : "Waiting"}
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="flex-[1_1_280px] text-meta text-pretty text-muted-foreground">
            Gemini doesn&apos;t report a percentage, so this shows the current stage and how long it has been running.
          </p>
          <button type="button" className={buttonClass("secondary", "lg", "px-4.5")} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function StageIcon({ status }: { status: "done" | "active" | "pending" }) {
  if (status === "done") {
    return (
      <div
        aria-hidden="true"
        className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-foreground text-card"
      >
        <Check className="size-3.5" strokeWidth={2.5} />
      </div>
    );
  }
  if (status === "active") return <Spinner size={22} />;
  return <div aria-hidden="true" className="box-border size-[22px] shrink-0 rounded-full border-2 border-control-border" />;
}
