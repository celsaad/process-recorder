"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useAnnounce } from "@/components/shell/LiveRegion";
import { AppError, toAppError } from "@/lib/errors";
import { captureFromVideo, waitForFrameData } from "@/lib/frames";
import { formatTimestamp } from "@/lib/timestamp";
import { stepHeadingDomId, type FramePickerProps } from "@/lib/ui-contracts";

/** Slider thumb diameter in px (the shadcn thumb is overridden below). The marker offset depends on it. */
const THUMB_PX = 22;
const SEEK_SETTLE_TIMEOUT_MS = 3000;
const LOAD_TIMEOUT_MS = 8000;
/** Caps the whole confirm (load + settle + capture). Esc is blocked while busy, so a stuck
 *  capture must not hold the dialog for the sum of the inner timeouts (~16 s). */
const CONFIRM_TIMEOUT_MS = 6000;

const roundTenth = (v: number) => Math.round(v * 10) / 10;

const STEP_BUTTONS = [
  { label: "−1 s", delta: -1 },
  { label: "−0.1 s", delta: -0.1 },
  { label: "+0.1 s", delta: 0.1 },
  { label: "+1 s", delta: 1 },
] as const;

const kbd = "rounded border border-control-border bg-background px-1.5 text-xs leading-5 text-foreground";

export function FramePicker({ open, onCancel, ...rest }: FramePickerProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      {/* Mounted only while open, so each opening starts fresh from `initialSec`. */}
      {open && <PickerBody onCancel={onCancel} {...rest} />}
    </Dialog>
  );
}

type BodyProps = Omit<FramePickerProps, "open">;

function PickerBody({ videoUrl, durationSec, initialSec, stepNumber, stepAction, onConfirm, onCancel }: BodyProps) {
  const announce = useAnnounce();
  // Radix only restores focus to a <DialogTrigger>. The "Pick frame" button lives in another
  // component, so remember what had focus when we opened and give it back on close (D13).
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const clamp = useCallback((v: number) => Math.min(durationSec, Math.max(0, v)), [durationSec]);
  const [sec, setSec] = useState(() => roundTenth(clamp(initialSec)));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  // False once the dialog is gone: a capture still in flight must never commit after that.
  const alive = useRef(true);
  // The confirm in flight, if any. Aborted when its time cap fires or the dialog goes away
  // (Cancel/Esc unmount the body), so a late `grab()` never seeks or keeps polling.
  const confirming = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      confirming.current?.abort();
    };
  }, []);
  const sliderWrapRef = useRef<HTMLDivElement | null>(null);
  // Only one seek is in flight; while it runs the newest requested time waits here (latest wins).
  const pendingSeek = useRef<number | null>(null);

  const requestSeek = useCallback((t: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (video.seeking) {
      pendingSeek.current = t;
      return;
    }
    if (Math.abs(video.currentTime - t) > 0.001) video.currentTime = t;
  }, []);

  useEffect(() => {
    requestSeek(sec);
  }, [sec, requestSeek]);

  const onSeeked = () => {
    const next = pendingSeek.current;
    if (next === null) return;
    pendingSeek.current = null;
    requestSeek(next);
  };

  // Radix puts role="slider" on the thumb but gives it no name; name it (keeps "step N" in it).
  const thumbProps = {
    "aria-label": `Video position for step ${stepNumber}`,
    "aria-valuetext": `${formatTimestamp(sec, 1)} of ${formatTimestamp(durationSec)}, original ${formatTimestamp(initialSec, 1)}`,
  };

  const step = (delta: number) => setSec((s) => roundTenth(clamp(s + delta)));

  const confirm = async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    setFailed(false);
    const ctrl = new AbortController();
    confirming.current = ctrl;
    const { signal } = ctrl;
    const check = () => {
      if (signal.aborted) throw new AppError("cancelled");
    };
    const grab = async () => {
      // Let the newest seek land before drawing, or the screenshot would show an older frame.
      await waitForFrameData(video, LOAD_TIMEOUT_MS, { signal });
      check();
      // The slider's seek runs in an effect after render, so an Enter pressed right
      // after an arrow key can arrive before that seek starts. Request it here too
      // (idempotent) so the wait below always covers the time being confirmed.
      requestSeek(sec);
      await waitForSeek(video, pendingSeek, SEEK_SETTLE_TIMEOUT_MS, signal);
      check();
      return captureFromVideo(video, { signal });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Reject first so the race reports the failure, not the abort's `cancelled`. Then stop
        // the late grab: it must not seek back to `sec` after the user has moved on.
        reject(new AppError("capture_failed"));
        ctrl.abort();
      }, CONFIRM_TIMEOUT_MS);
    });
    try {
      const shot = await Promise.race([grab(), deadline]);
      clearTimeout(timer);
      if (!alive.current) return;
      await onConfirm(sec, shot);
    } catch (e) {
      clearTimeout(timer);
      if (!alive.current) return;
      const err = toAppError(e);
      if (err.kind !== "cancelled") {
        setFailed(true);
        announce("Couldn't capture this frame. Try a nearby moment.");
      }
    } finally {
      if (confirming.current === ctrl) confirming.current = null;
    }
    if (alive.current) setBusy(false);
  };

  const onSliderKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void confirm();
  };

  const fraction = durationSec > 0 ? Math.min(1, Math.max(0, initialSec / durationSec)) : 0;
  const markerLeft = `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${fraction})`;

  return (
    <DialogContent
      showCloseButton={false}
      className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[760px]"
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (opener?.isConnected) opener.focus();
        // The opener can be gone (e.g. a failed-capture placeholder becomes an image): use the step heading.
        else document.getElementById(stepHeadingDomId(stepNumber))?.focus();
      }}
      // An in-flight capture can't be cancelled; ignore dismissals until it settles (at most CONFIRM_TIMEOUT_MS).
      onEscapeKeyDown={(e) => busy && e.preventDefault()}
      onInteractOutside={(e) => busy && e.preventDefault()}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        sliderWrapRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
      }}
    >
      <DialogHeader className="gap-0.5 px-6 pt-5 pb-4">
        <DialogTitle className="text-xl leading-7 font-semibold tracking-tight">
          Pick a frame for step {stepNumber}
        </DialogTitle>
        {stepAction && <p className="text-[13px] leading-[18px] text-foreground/80">{stepAction}</p>}
      </DialogHeader>

      <div className="flex flex-col gap-3 px-6">
        <div className="aspect-[16/10] max-h-[50vh] w-[min(100%,80vh)] self-center overflow-hidden rounded-lg border border-control-border bg-muted">
          <video
            ref={videoRef}
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            aria-label={`Video frame at ${formatTimestamp(sec, 1)} for step ${stepNumber}`}
            className="block h-full w-full object-contain"
            style={{ maxHeight: "50vh" }}
            onLoadedMetadata={() => requestSeek(sec)}
            onSeeked={onSeeked}
          />
        </div>

        <div>
          <div ref={sliderWrapRef} onKeyDown={onSliderKeyDown} className="relative h-11">
            <Slider
              min={0}
              max={durationSec}
              step={0.1}
              value={[sec]}
              onValueChange={([v]) => setSec(roundTenth(clamp(v)))}
              disabled={busy}
              thumbProps={thumbProps}
              className={
                "h-11 " +
                "[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-control-border " +
                "[&_[data-slot=slider-thumb]]:size-[22px] [&_[data-slot=slider-thumb]]:border-[3px] [&_[data-slot=slider-thumb]]:border-primary"
              }
            />
            <span
              aria-hidden="true"
              data-testid="original-marker"
              className="pointer-events-none absolute top-2.5 h-6 w-0.5 -translate-x-1/2 bg-foreground"
              style={{ left: markerLeft }}
            />
          </div>
          <div aria-hidden="true" className="relative h-5">
            <span
              className="absolute top-0 -translate-x-1/2 rounded bg-foreground px-1.5 text-xs leading-[18px] font-semibold whitespace-nowrap text-background tabular-nums"
              style={{ left: markerLeft }}
            >
              Original {formatTimestamp(initialSec)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {STEP_BUTTONS.slice(0, 2).map((b) => (
            <StepButton key={b.label} {...b} stepNumber={stepNumber} disabled={busy} onStep={step} />
          ))}
          <p className="mx-3 min-w-[132px] text-center text-2xl leading-8 font-semibold tracking-tight tabular-nums">
            {formatTimestamp(sec, 1)}{" "}
            <span className="text-sm font-normal text-muted-foreground">/ {formatTimestamp(durationSec)}</span>
          </p>
          {STEP_BUTTONS.slice(2).map((b) => (
            <StepButton key={b.label} {...b} stepNumber={stepNumber} disabled={busy} onStep={step} />
          ))}
        </div>

        <DialogDescription className="flex flex-wrap items-center justify-center gap-1.5 text-[13px] leading-5 text-foreground/80">
          <kbd className={kbd}>←</kbd>
          <kbd className={kbd}>→</kbd>
          <span>step</span>
          <span aria-hidden="true">·</span>
          <kbd className={kbd}>Shift</kbd>
          <span>for 1 s</span>
          <span aria-hidden="true">·</span>
          <kbd className={kbd}>Enter</kbd>
          <span>to use</span>
          <span aria-hidden="true">·</span>
          <kbd className={kbd}>Esc</kbd>
          <span>to cancel</span>
        </DialogDescription>

        {failed && (
          <p className="text-center text-sm text-destructive">
            Couldn&apos;t capture this frame. Try a nearby moment, or cancel.
          </p>
        )}
      </div>

      <DialogFooter className="mx-0 mt-4 mb-0 rounded-b-xl border-t px-6 py-4 sm:justify-end">
        <Button type="button" variant="outline" className="h-11 px-4 text-sm font-semibold" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          className="h-11 px-5 text-sm font-semibold"
          onClick={() => void confirm()}
          disabled={busy}
          aria-label={`Use this frame for step ${stepNumber}`}
        >
          Use this frame
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function StepButton({
  label,
  delta,
  stepNumber,
  disabled,
  onStep,
}: {
  label: string;
  delta: number;
  stepNumber: number;
  disabled: boolean;
  onStep: (delta: number) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      // Visible text stays a prefix of the name (WCAG 2.5.3).
      aria-label={`${label} for step ${stepNumber}`}
      className="h-11 min-w-[68px] border-control-border px-3 text-sm font-semibold tabular-nums"
      onClick={() => onStep(delta)}
    >
      {label}
    </Button>
  );
}

/** Resolves once the video has no seek in flight (and no newer one queued), or when `signal` aborts. */
function waitForSeek(
  video: HTMLVideoElement,
  pending: { current: number | null },
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || (!video.seeking && pending.current === null)) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const done = () => {
      if (!video.seeking && pending.current === null) finish();
    };
    // Give up waiting and capture whatever is shown; captureFromVideo has its own seek timeout.
    const timer = setTimeout(finish, timeoutMs);
    video.addEventListener("seeked", done);
    signal.addEventListener("abort", finish);
  });
}
