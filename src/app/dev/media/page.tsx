"use client";

// Lane C dev page: probe a video, capture frames, open the FramePicker, export the fixture project.
import { useEffect, useRef, useState } from "react";
import { FramePicker } from "@/components/frames/FramePicker";
import { Button } from "@/components/ui/button";
import { toAppError } from "@/lib/errors";
import { buildDocx, downloadBlob, exportFilename } from "@/lib/export-docx";
import { createFrameGrabber, probeVideo, validateFile } from "@/lib/frames";
import { formatBytes, formatTimestamp } from "@/lib/timestamp";
import type { VideoInfo } from "@/lib/types";
import { fixtureProject, fixtureShotUrls } from "@/fixtures/project";

type Capture = { sec: number; url: string; bytes: number; type: string; ms: number };

export default function MediaDevPage() {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [status, setStatus] = useState("Pick a video file.");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<{ sec: number; url: string } | null>(null);
  const [sizes, setSizes] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const track = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  };

  async function onFile(f: File) {
    setFile(f);
    setInfo(null);
    setCaptures([]);
    setPicked(null);
    setSizes(null);
    try {
      validateFile(f);
      setStatus("Probing…");
      const probed = await probeVideo(f);
      setInfo(probed);
      setVideoUrl(track(f));
      setStatus("Probed.");
    } catch (e) {
      const err = toAppError(e);
      setStatus(`${err.kind}${err.detail ? `: ${err.detail}` : ""}`);
    }
  }

  async function captureThree() {
    if (!file || !info) return;
    const grabber = createFrameGrabber(file);
    const out: Capture[] = [];
    try {
      for (const frac of [0.1, 0.5, 0.9]) {
        const sec = Math.round(info.durationSec * frac * 10) / 10;
        setStatus(`Capturing ${formatTimestamp(sec, 1)}…`);
        const t0 = performance.now();
        const blob = await grabber.capture(sec);
        out.push({ sec, url: track(blob), bytes: blob.size, type: blob.type, ms: Math.round(performance.now() - t0) });
        setCaptures([...out]);
      }
      setStatus("Captured 3 frames.");
    } catch (e) {
      setStatus(`Capture failed: ${toAppError(e).kind}`);
    } finally {
      grabber.dispose();
    }
  }

  /** D3: lossy WebP 0.9 vs lossless (quality 1 is lossless in Chrome) on the first capture. */
  async function compareWebp() {
    const first = captures[0];
    if (!first) return;
    const img = await createImageBitmap(await (await fetch(first.url)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    const toBlob = (q: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", q));
    const [lossy, lossless] = await Promise.all([toBlob(0.9), toBlob(1)]);
    setSizes(
      `${img.width}×${img.height}: WebP 0.9 = ${formatBytes(lossy?.size ?? 0)}, WebP 1.0 (lossless) = ${formatBytes(lossless?.size ?? 0)}`,
    );
  }

  async function exportFixture() {
    setStatus("Building docx…");
    const started = performance.now();
    const blob = await buildDocx(fixtureProject, fixtureProject.steps, async (id) => {
      const res = await fetch(fixtureShotUrls[id]);
      return res.ok ? res.blob() : null;
    });
    downloadBlob(blob, exportFilename(fixtureProject.title));
    setStatus(`Exported ${formatBytes(blob.size)} in ${Math.round(performance.now() - started)} ms.`);
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Media dev page (Lane C)</h1>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Video file
        <input
          type="file"
          accept="video/*,.mov"
          onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
        />
      </label>
      <p className="text-sm text-muted-foreground">{status}</p>
      {info && (
        <pre className="rounded-md bg-muted p-3 text-xs">{JSON.stringify(info, null, 2)}</pre>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void captureThree()} disabled={!info}>
          Capture at 10%, 50%, 90%
        </Button>
        <Button type="button" variant="outline" onClick={() => setPickerOpen(true)} disabled={!info}>
          Pick frame for step 1
        </Button>
        <Button type="button" variant="outline" onClick={() => void compareWebp()} disabled={!captures.length}>
          Compare WebP sizes
        </Button>
        <Button type="button" variant="outline" onClick={() => void exportFixture()}>
          Export fixture project (.docx)
        </Button>
      </div>
      {sizes && <p className="text-sm">{sizes}</p>}

      <ul className="grid grid-cols-3 gap-3">
        {captures.map((c) => (
          <li key={c.sec} className="text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element -- object URL from a dev capture */}
            <img src={c.url} alt={`Capture at ${formatTimestamp(c.sec, 1)}`} className="w-full rounded border" />
            {formatTimestamp(c.sec, 1)} · {c.type} · {formatBytes(c.bytes)} · {c.ms} ms
          </li>
        ))}
      </ul>

      {picked && (
        <div className="text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- object URL from a dev capture */}
          <img src={picked.url} alt={`Picked frame at ${formatTimestamp(picked.sec, 1)}`} className="w-64 rounded border" />
          Picked {formatTimestamp(picked.sec, 1)}
        </div>
      )}

      {info && videoUrl && (
        <FramePicker
          open={pickerOpen}
          videoUrl={videoUrl}
          durationSec={info.durationSec}
          initialSec={Math.min(4, info.durationSec)}
          stepNumber={1}
          onConfirm={(sec, shot) => {
            setPicked({ sec, url: track(shot) });
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </main>
  );
}
