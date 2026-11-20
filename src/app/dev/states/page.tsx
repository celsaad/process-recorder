"use client";

// Every Lane D component in every state, from fixtures (IMPLEMENTATION.md Lane D item 7).
// Visual and keyboard checks happen here in Phase 2. Not linked from the app.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppHeader } from "@/components/shell/AppHeader";
import { buttonClass } from "@/components/shell/button-styles";
import { Dropzone } from "@/components/upload/Dropzone";
import { EmptyState } from "@/components/upload/EmptyState";
import { JobProgress, longVideoNotice } from "@/components/upload/JobProgress";
import { CaptureBanner } from "@/components/upload/CaptureBanner";
import { ErrorDetail, ErrorPanel } from "@/components/feedback/ErrorPanel";
import { Banner } from "@/components/feedback/Banner";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { ProjectTitle } from "@/components/project/ProjectTitle";
import { ExportButton, ExportFailedToast } from "@/components/project/ExportButton";
import { NoSteps } from "@/components/project/NoSteps";
import { ERROR_KINDS } from "@/lib/errors";
import type { ConfirmKind, RunningJob } from "@/lib/ui-contracts";
import type { ErrorKind, SaveStatus, SerializedAppError, VideoInfo } from "@/lib/types";
import { fixtureProject } from "@/fixtures/project";

const shortVideo: VideoInfo = fixtureProject.video;
const longVideo: VideoInfo = { ...fixtureProject.video, durationSec: 326, sizeBytes: 12_582_912 };

const DETAILS: Partial<Record<ErrorKind, string>> = {
  unsupported_type: ".pdf",
  too_long: "12:40",
  too_large: "640 MB",
  not_screen_recording: "The video shows a person talking to a camera in an office. No software interface is visible.",
};

const DETAIL_AREA: Partial<Record<ErrorKind, ReactNode>> = {
  rate_limited: <ErrorDetail>Your video is already uploaded. Retry won&apos;t upload it again.</ErrorDetail>,
  bad_model_output: <ErrorDetail>Your video is already uploaded. Retry won&apos;t upload it again.</ErrorDetail>,
  missing_api_key: (
    <ErrorDetail>
      <p className="text-meta font-semibold text-foreground-2">.env.local</p>
      <pre className="font-mono text-meta leading-5 whitespace-pre-wrap">GEMINI_API_KEY=your-key-here</pre>
    </ErrorDetail>
  ),
};

// The clock is read on the client only (prerendering must not read the current time).
// Fixed at first read, 23 s in the past, so the elapsed time reads 0:23 when the page loads.
let pageStartedAt = 0;
const subscribe = () => () => {};
const clientStartedAt = () => (pageStartedAt ||= Date.now() - 23_000);
const serverStartedAt = () => 0;

function job(
  startedAt: number,
  stage: RunningJob["stage"],
  completed: RunningJob["completed"],
  capture?: RunningJob["capture"],
): RunningJob {
  return { phase: "running", stage, stageStartedAt: startedAt, completed, capture };
}

const noop = () => {};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function DevStatesPage() {
  const startedAt = useSyncExternalStore(subscribe, clientStartedAt, serverStartedAt);
  const [title, setTitle] = useState(fixtureProject.title);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [lastConfirm, setLastConfirm] = useState<string>("");
  // ErrorPanel focuses its h1 on mount; show one at a time so focus isn't fought over.
  const [errorKind, setErrorKind] = useState<ErrorKind>("too_long");
  const error: SerializedAppError = { kind: errorKind, detail: DETAILS[errorKind] };

  return (
    <main className="flex flex-col gap-12 bg-[#E6E9EE] px-[clamp(16px,3vw,40px)] py-9">
      <h1 className="text-2xl font-semibold">Lane D states</h1>

      <Sheet title="AppHeader: empty state">
        <AppHeader saveStatus="idle" />
      </Sheet>
      {(["saved", "saving", "error", "idle"] as SaveStatus[]).map((s) => (
        <Sheet key={s} title={`AppHeader: editor, save status "${s}"`}>
          <AppHeader
            saveStatus={s}
            onStartNew={noop}
            title={<ProjectTitle value={title} onChange={setTitle} />}
            actions={<ExportButton onExport={() => wait(1500)} />}
          />
        </Sheet>
      ))}
      <Sheet title="ExportButton: exporting (never finishes)">
        <OnMount run={(el) => el.querySelector("button")?.click()}>
          <div className="p-4">
            <ExportButton onExport={() => new Promise<void>(() => {})} />
          </div>
        </OnMount>
      </Sheet>
      <Sheet title="ProjectTitle: renaming">
        <OnMount run={(el) => el.querySelector<HTMLButtonElement>("button[aria-label='Rename process']")?.click()}>
          <div className="p-4">
            <ProjectTitle value={title} onChange={setTitle} />
          </div>
        </OnMount>
      </Sheet>
      <Sheet title="ExportButton: always fails (toast with Try again)">
        <div className="p-4">
          <ExportButton
            onExport={async () => {
              await wait(800);
              throw new Error("boom");
            }}
          />
        </div>
        <div className="flex justify-center bg-background p-5">
          <ExportFailedToast onRetry={noop} onDismiss={noop} />
        </div>
      </Sheet>

      <Sheet title="EmptyState">
        <EmptyState onFile={(f) => alert(`onFile: ${f.name}`)} />
      </Sheet>
      <Sheet title="Dropzone: file dragged over">
        <OnMount run={(el) => el.querySelector("[data-testid=dropzone]")?.dispatchEvent(new Event("dragenter", { bubbles: true }))}>
          <div className="p-6">
            <Dropzone onFile={noop} />
          </div>
        </OnMount>
      </Sheet>
      <Sheet title="Dropzone: disabled">
        <div className="p-6">
          <Dropzone onFile={noop} disabled />
        </div>
      </Sheet>

      {startedAt > 0 && (
        <>
          <Sheet title="JobProgress: screenshots (if shown before the editor)">
            <JobProgress
              job={job(
                startedAt,
                "capturing",
                ["validating", "received", "sending_to_gemini", "gemini_processing", "analyzing"],
                { done: 2, total: 4 },
              )}
              video={shortVideo}
              onCancel={noop}
            />
          </Sheet>
      <Sheet title="JobProgress: validating">
        <JobProgress job={job(startedAt, "validating", [])} video={shortVideo} onCancel={noop} />
      </Sheet>
      <Sheet title="JobProgress: receiving">
        <JobProgress job={job(startedAt, "received", ["validating"])} video={shortVideo} onCancel={noop} />
      </Sheet>
      <Sheet title="JobProgress: sending to Gemini">
        <JobProgress job={job(startedAt, "sending_to_gemini", ["validating", "received"])} video={shortVideo} onCancel={noop} />
      </Sheet>
      <Sheet title="JobProgress: Gemini processing, long video (5:26)">
        <JobProgress
          job={job(startedAt, "gemini_processing", ["validating", "received", "sending_to_gemini"])}
          video={longVideo}
          onCancel={noop}
        />
      </Sheet>
      <Sheet title="JobProgress: analyzing">
        <JobProgress
          job={job(startedAt, "analyzing", ["validating", "received", "sending_to_gemini", "gemini_processing"])}
          video={shortVideo}
          onCancel={noop}
        />
      </Sheet>

        </>
      )}

      <Sheet title="CaptureBanner + long-video Banner (editor top)">
        <div className="flex flex-col gap-4 p-6">
          <Banner tone="info">{longVideoNotice(longVideo.durationSec)}</Banner>
          <CaptureBanner done={2} total={4} />
        </div>
      </Sheet>
      <Sheet title="Banner: storage full (warning)">
        <Banner tone="warning" action={{ label: "Export to Word", onClick: noop }}>
          <strong className="font-semibold">This browser&apos;s storage is full.</strong> Changes won&apos;t survive a
          refresh. Export now.
        </Banner>
      </Sheet>

      <Sheet title="ErrorPanel (pick a kind)">
        <div className="flex flex-col gap-4 p-6">
          <label className="flex items-center gap-2 text-sm">
            Error kind
            <select
              className="h-10 rounded-lg border border-control-border bg-card px-2"
              value={errorKind}
              onChange={(e) => setErrorKind(e.target.value as ErrorKind)}
            >
              {ERROR_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <ErrorPanel
            key={errorKind}
            error={error}
            onPrimary={noop}
            onSecondary={errorKind === "rate_limited" || errorKind === "gemini_failed" ? noop : undefined}
          >
            {DETAIL_AREA[errorKind]}
          </ErrorPanel>
        </div>
      </Sheet>

      <Sheet title="NoSteps">
        <NoSteps onAddStep={noop} />
      </Sheet>

      <Sheet title="ConfirmDialog">
        <div className="flex flex-wrap items-center gap-3 p-6">
          <button type="button" className={buttonClass("secondary")} onClick={() => setConfirm("start_new")}>
            Open “Start new”
          </button>
          <button type="button" className={buttonClass("secondary")} onClick={() => setConfirm("replace")}>
            Open “Replace”
          </button>
          <p className="text-sm text-foreground-2">{lastConfirm}</p>
        </div>
        <ConfirmDialog
          open={confirm !== null}
          kind={confirm ?? "start_new"}
          onResolve={(ok) => {
            setLastConfirm(`Resolved: ${ok}`);
            setConfirm(null);
          }}
        />
      </Sheet>
    </main>
  );
}

function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-meta font-semibold text-foreground-2">{title}</h2>
      <div className="overflow-visible rounded-xl border border-control-border bg-background p-2">{children}</div>
    </section>
  );
}

/** Puts a component into a state that only user input reaches (drag-over, busy, renaming). */
function OnMount({ run, children }: { run: (el: HTMLElement) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ref.current) return;
    done.current = true;
    run(ref.current);
  }, [run]);
  return <div ref={ref}>{children}</div>;
}
