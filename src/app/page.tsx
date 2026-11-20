"use client";
// Lane F. The single page: one screen per job phase (D7, UX.md "Screen states").
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { StepList } from "@/components/editor/StepList";
import { Banner } from "@/components/feedback/Banner";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { ErrorDetail, ErrorPanel } from "@/components/feedback/ErrorPanel";
import { FramePicker } from "@/components/frames/FramePicker";
import { ExportButton } from "@/components/project/ExportButton";
import { NoSteps } from "@/components/project/NoSteps";
import { ProjectTitle } from "@/components/project/ProjectTitle";
import { AppHeader } from "@/components/shell/AppHeader";
import { CaptureBanner } from "@/components/upload/CaptureBanner";
import { EmptyState } from "@/components/upload/EmptyState";
import { JobProgress } from "@/components/upload/JobProgress";
import { longVideoNotice, useProcessRecorder } from "@/hooks/useProcessRecorder";
import { ERROR_COPY } from "@/lib/errors";
import type { ErrorKind } from "@/lib/types";
import { ACCEPTED_EXTENSIONS, ACCEPTED_TYPES, isLongVideo } from "@/lib/limits";

const ACCEPT = [...ACCEPTED_TYPES, ...ACCEPTED_EXTENSIONS].join(",");

/** Per-kind "what to do" lines under the error message (Errors and StatesUpload boards). */
function errorHint(kind: ErrorKind): ReactNode {
  switch (kind) {
    case "too_long":
      return <p>Trim it to the part that shows the process, or record a shorter take.</p>;
    case "undecodable":
      return <p>Nothing was sent to Gemini.</p>;
    case "missing_api_key":
      return (
        <>
          <ErrorDetail>
            <p className="text-meta font-semibold text-foreground-2">.env.local</p>
            <pre className="font-mono text-meta leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap">
              GEMINI_API_KEY=your-key-here
            </pre>
          </ErrorDetail>
          <p>Save the file in the project root, then stop and start the dev server. This page will work once the key is found.</p>
        </>
      );
    default:
      return null;
  }
}

export default function Home() {
  const r = useProcessRecorder();
  const { job, project, steps } = r;
  const [pickingId, setPickingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const capturing = job.phase === "running" && job.stage === "capturing";
  const editor = (job.phase === "ready" || capturing) && project ? project : null;
  const pickIndex = pickingId ? steps.steps.findIndex((s) => s.id === pickingId) : -1;
  const pickStep = pickIndex >= 0 ? steps.steps[pickIndex] : null;

  const chooseFile = () => fileInput.current?.click();
  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (file) r.onFile(file);
  };

  let content;
  if (editor) {
    content = (
      <div className="flex flex-col gap-4">
        {isLongVideo(editor.video.durationSec) && (
          <Banner tone="info">{longVideoNotice(editor.video.durationSec)}</Banner>
        )}
        {job.phase === "running" && job.capture && (
          <CaptureBanner done={job.capture.done} total={job.capture.total} />
        )}
        {steps.steps.length > 0 || steps.lastDeleted ? (
          <StepList
            steps={steps.steps}
            lastDeleted={steps.lastDeleted}
            shotUrls={r.shotUrls}
            dispatch={r.dispatch}
            onPickFrame={setPickingId}
            onAddStep={(afterId) => void r.addStep(afterId)}
          />
        ) : (
          <NoSteps onAddStep={() => void r.addStep(null)} />
        )}
      </div>
    );
  } else if (job.phase === "running" && project) {
    // Includes `validating` ("Checking your recording"); the draft project carries the File's info.
    content = <JobProgress job={job} video={project.video} onCancel={r.cancel} />;
  } else if (job.phase === "error") {
    const copy = ERROR_COPY[job.error.kind];
    const hint = errorHint(job.error.kind);
    // Only pass children when there is something to show: ErrorPanel renders a detail area for any.
    const detail =
      job.retryFrom === "analyze" || hint ? (
        <>
          {job.retryFrom === "analyze" && <p>Your video is already uploaded. Retry won&apos;t upload it again.</p>}
          {hint}
        </>
      ) : undefined;
    const onPrimary =
      copy.primaryAction === "retry"
        ? r.retry
        : copy.primaryAction === "choose_file"
          ? chooseFile
          : copy.primaryAction === "export"
            ? () => void r.exportDocx()
            : () => {};
    content = (
      <ErrorPanel
        error={job.error}
        onPrimary={onPrimary}
        onSecondary={copy.primaryAction === "retry" ? chooseFile : undefined}
      >
        {detail}
      </ErrorPanel>
    );
  } else {
    content = <EmptyState onFile={r.onFile} />;
  }

  return (
    <>
      <AppHeader
        saveStatus={r.saveStatus}
        onStartNew={editor ? r.startNew : undefined}
        title={editor ? <ProjectTitle value={editor.title} onChange={r.setTitle} /> : undefined}
        actions={editor ? <ExportButton onExport={r.exportDocx} /> : undefined}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6 sm:px-8">
        {r.storageFull && (
          <Banner tone="warning" action={{ label: "Export", onClick: () => void r.exportDocx() }}>
            {ERROR_COPY.storage_full.body()}
          </Banner>
        )}
        {content}
      </main>

      {editor && r.videoUrl && (
        <FramePicker
          open={pickStep !== null}
          videoUrl={r.videoUrl}
          durationSec={editor.video.durationSec}
          initialSec={pickStep?.timestampSec ?? 0}
          stepNumber={pickIndex + 1}
          onConfirm={async (sec, shot) => {
            if (pickStep) await r.repick(pickStep.id, sec, shot);
            setPickingId(null);
          }}
          onCancel={() => setPickingId(null)}
        />
      )}

      <ConfirmDialog
        open={r.pendingConfirm !== null}
        kind={r.pendingConfirm ?? "start_new"}
        onResolve={r.resolveConfirm}
        projectTitle={project?.title}
        fileName={r.pendingFileName ?? undefined}
      />

      {/* "Choose another file" from the error panel; the dropzone has its own input. */}
      <input ref={fileInput} type="file" accept={ACCEPT} hidden tabIndex={-1} aria-hidden onChange={onInputChange} />
    </>
  );
}
