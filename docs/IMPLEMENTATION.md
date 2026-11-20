# Implementation plan

How the build is split so several agents can work at the same time without stepping on each other.

- **Phase 0, Foundation:** one agent, serial. Installs dependencies and writes the **shared contracts** (types, error catalog, function signatures as stubs) that every lane codes against.
- **Phase 1, Lanes:** five agents in parallel, each in its **own git worktree and branch**, each **owning a disjoint set of files**. Lanes code against the contracts, not against each other's work, so they never wait on each other.
- **Phase 2, Integration:** one agent, serial. Merges the lanes, writes the orchestrating hook, and runs end-to-end with real videos.
- **Phase 3, Hardening:** review, a11y pass, docs.

```
Phase 0 ──► ┌ A  Server + Gemini ─────┐
 (20 min)   ├ B  Client logic + data ─┤
            ├ C  Media + export ──────┼──► Phase 2 ──► Phase 3
            ├ D  Shell + upload UI ───┤    (40 min)    (20 min)
            └ E  Editor UI ───────────┘
                     (≈60 min)
```

Decisions referenced as D1–D15 are in [DECISIONS.md](DECISIONS.md). Screen states and keyboard flow are in [UX.md](UX.md). Visual design: the Claude Design canvas (link in the README once it's finalized).

---

## Ground rules for every lane agent

1. **Only edit files your lane owns** (listed per lane). Need a change in a shared contract file or another lane's file? Don't make it. Write it under "Contract change requests" in your final report.
2. **Don't add dependencies.** Phase 0 installs everything listed below. If you truly need another, report it instead of installing it, because concurrent edits to `package.json` / `pnpm-lock.yaml` conflict.
3. **Next.js 16 has breaking changes.** Read the relevant guide in `node_modules/next/dist/docs/` before writing route handlers or app files. **Never create `proxy.ts`** (D2).
4. **Definition of done:** `pnpm typecheck`, `pnpm lint` and `pnpm test` pass. Pure functions have Vitest tests next to them (`*.test.ts`). Commit on your lane branch with a clear message.
5. **Final report (≤300 words):** what's built, what's stubbed or known-broken, contract change requests, anything that contradicts the docs.
6. Pure logic in `src/lib/` must not import React or Next.

---

## Phase 0: Foundation (serial, ≈20 min)

**Owner:** the main session. Done before any lane starts. Committed to `main`.

1. **Dependencies:**
   - Runtime: `@google/genai`, `zod`, `idb-keyval`, `docx`, `lucide-react`
   - Dev: `vitest`, `@vitest/coverage-v8`, `jsdom`, `fake-indexeddb`
   - `shadcn init`, then add: `button`, `textarea`, `label`, `dialog`, `alert-dialog`, `slider`, `tooltip`, `sonner`, `skeleton`, `badge`. Fall back to Radix primitives if init fights the Next 16 config (D2).
2. **Scripts:** `test` (`vitest run`), `test:watch`, `typecheck` (`tsc --noEmit`).
3. **Contracts:** write `src/lib/types.ts` and `src/lib/errors.ts` in full (below).
4. **Stubs:** create every file in the module map with the exact exported signatures below. Bodies `throw new Error("not implemented")`. Lanes replace the bodies. This keeps all lanes type-checking against the same API from minute one.
5. **Fixtures:** `src/fixtures/project.ts` with a realistic 4-step project ("Create a purchase order") and `src/fixtures/shots/*.webp` placeholder images, so UI lanes can render without a backend.
6. **Spike (15 min, can overlap with step 4):** with a sample video, confirm `GEMINI_MODEL` accepts video + the response schema, `video/quicktime` works, and Next 16 route handlers can pipe `request.body` to disk and see `request.signal` abort. Record the results in DECISIONS (D4, D5) and hand them to Lane A.

### `src/lib/types.ts` (the shared contract)

```ts
// ---------- Domain ----------
export type Rect = { x: number; y: number; w: number; h: number }; // normalized 0–1

export type CaptureState = "pending" | "ok" | "failed";

export type Step = {
  id: string;
  action: string;
  description: string;
  expectedResult: string;
  timestampSec: number;
  captureState: CaptureState;
  highlight: Rect | null;
  highlightSource: "gemini" | "user" | null;
};

export type VideoInfo = {
  name: string;
  sizeBytes: number;
  mimeType: string;
  durationSec: number;
  width: number;
  height: number;
};

export type Project = {
  id: string;
  title: string;
  video: VideoInfo;
  gemini?: { fileName: string; mimeType: string; uploadedAt: string };
  steps: Step[];
  updatedAt: string;
};

// ---------- API contract (D4) ----------
export type UploadStage = "received" | "sending_to_gemini" | "gemini_processing";

export type UploadEvent =
  | { type: "stage"; stage: UploadStage }
  | { type: "ready"; fileName: string; mimeType: string }
  | { type: "error"; error: SerializedAppError };

export type RawStep = {            // after server normalization (sorted, de-duped)
  action: string;
  description: string;
  expectedResult: string;
  timestampSec: number;
  box: Rect | null;                // converted from box_2d
};

export type AnalyzeResponse =
  | { ok: true; processTitle: string; steps: RawStep[] }
  | { ok: false; error: SerializedAppError };

// ---------- Errors (D10) ----------
export type ErrorKind =
  | "missing_api_key" | "unsupported_type" | "too_long" | "too_large" | "undecodable"
  | "network" | "rate_limited" | "gemini_failed" | "gemini_blocked" | "bad_model_output"
  | "file_expired" | "not_screen_recording" | "no_steps" | "capture_failed"
  | "storage_full" | "cancelled";

export type SerializedAppError = { kind: ErrorKind; detail?: string };

// ---------- Job state machine (D7) ----------
export type JobStage =
  | "validating" | UploadStage | "analyzing" | "capturing";

export type RetryFrom = "upload" | "analyze" | "capture";

export type JobState =
  | { phase: "idle" }
  | { phase: "running"; stage: JobStage; stageStartedAt: number; completed: JobStage[];
      capture?: { done: number; total: number } }
  | { phase: "ready" }
  | { phase: "error"; error: SerializedAppError; retryFrom: RetryFrom | null };

export type JobAction =
  | { type: "start" }
  | { type: "stage"; stage: JobStage; at: number }
  | { type: "captureProgress"; done: number; total: number }
  | { type: "succeed" }
  | { type: "fail"; error: SerializedAppError; retryFrom: RetryFrom | null }
  | { type: "cancel" }
  | { type: "reset" };

// ---------- Steps reducer (D7, D12) ----------
export type StepsState = { steps: Step[]; lastDeleted: { step: Step; index: number } | null };

export type StepsAction =
  | { type: "load"; steps: Step[] }
  | { type: "update"; id: string; patch: Partial<Pick<Step, "action" | "description" | "expectedResult">> }
  | { type: "add"; afterId: string | null; step: Step }
  | { type: "remove"; id: string }
  | { type: "undoRemove" }
  | { type: "move"; id: string; direction: "up" | "down" }
  | { type: "setTimestamp"; id: string; timestampSec: number }   // re-pick: also clears a gemini highlight (D9)
  | { type: "setCaptureState"; id: string; captureState: CaptureState }
  | { type: "setHighlight"; id: string; highlight: Rect | null; source: "gemini" | "user" | null };
```

### `src/lib/errors.ts`

```ts
export class AppError extends Error { kind: ErrorKind; detail?: string }
export function toAppError(e: unknown): AppError;          // AbortError → cancelled, TypeError fetch → network, …
export function serialize(e: AppError): SerializedAppError;
export function isRetryable(kind: ErrorKind): boolean;
export const ERROR_COPY: Record<ErrorKind, {
  title: string;                  // "This video can't be played here"
  body: (detail?: string) => string;
  primaryAction: "choose_file" | "retry" | "add_step" | "export" | "none";
}>;
```

The copy comes from the D10 table. It lives in one place so server and UI agree.

---

## Phase 1: Lanes (parallel, ≈60 min)

Each lane runs as one agent with `isolation: "worktree"` on branch `lane/<letter>-<name>`.

### Lane A: Server + Gemini

**Owns:** `src/server/**`, `src/app/api/**`, `src/lib/schema.ts`, `src/lib/normalize.ts` (+ tests)

| File | Exports |
|---|---|
| `server/gemini.ts` | `getClient()` (throws `missing_api_key`), `uploadAndWait(path, mimeType, signal) → {fileName, mimeType}`, `generateSteps(fileName, signal) → {processTitle, steps: RawStep[]}`, `deleteFile(fileName)`, `classifyGeminiError(e) → AppError` |
| `server/prompt.ts` | `PROMPT`, `RESPONSE_SCHEMA` (D5: all fields required, `propertyOrdering`, `box_2d` int array length 4) |
| `lib/schema.ts` | zod `GeminiResponseSchema`, `UploadEventSchema`, `AnalyzeResponseSchema` (the client validates server responses too) |
| `lib/normalize.ts` | `normalizeSteps(raw) → RawStep[]`: parse `MM:SS`, sort, nudge duplicates +0.5 s, `box_2d` → `Rect` (uses `lib/geometry` from Lane B. Until it merges, depend only on its stub signature) |
| `app/api/upload/route.ts` | `POST`: Content-Length ≤ 500 MB, `video/*` only, stream to tmp, NDJSON `UploadEvent`s, 2 min poll timeout, delete tmp in `finally` |
| `app/api/analyze/route.ts` | `POST {fileName}` → `AnalyzeResponse`. Check `finishReason`, zod validate, one retry with the error added to the prompt, 404 → `file_expired`, 429 → `rate_limited` |
| `app/api/file/route.ts` | `DELETE {fileName}` → 204 (used by "Start new") |

**Tests:** `normalize`, zod schemas against fixture responses (valid, missing field, `box_2d` length 3, `MM:SS.s` input), `classifyGeminiError`.
**Manual check:** `curl` both endpoints with a sample video; paste one real response into `src/fixtures/gemini-response.json` for the other lanes.

### Lane B: Client logic + data

**Owns:** `src/lib/timestamp.ts`, `geometry.ts`, `job-machine.ts`, `steps-reducer.ts`, `persistence.ts`, `api-client.ts` (+ tests)

| File | Exports |
|---|---|
| `timestamp.ts` | `parseTimestamp(s, durationSec?) → number \| null`, `formatTimestamp(sec, precision: 0 \| 1 = 0) → "1:05" / "1:05.3"` |
| `geometry.ts` | `box2dToRect(box: number[]) → Rect \| null`, `clampRect(r)`, `moveRect(r, dx, dy)`, `resizeRect(r, dw, dh)`, `MIN_RECT` |
| `job-machine.ts` | `jobReducer(state, action)`, `initialJob` |
| `steps-reducer.ts` | `stepsReducer(state, action)`, `initialSteps`, `stepsFromRaw(raw: RawStep[], durationSec) → Step[]` (ids, clamping, `captureState: "pending"`) |
| `persistence.ts` | `loadAll() → {project, video} \| null`, `saveProjectNow(p)`, `createDebouncedSaver(ms = 500) → {schedule(p), flush(), cancel()}`, `saveVideo(blob)`, `saveShot(id, blob)`, `loadShot(id)`, `deleteShot(id)`, `clearAll()`. `QuotaExceededError` → `AppError("storage_full")` |
| `api-client.ts` | `uploadVideo(file, {signal, onStage}) → {fileName, mimeType}` (reads NDJSON), `analyzeVideo(fileName, {signal}) → {processTitle, steps}`, `deleteGeminiFile(fileName)`. Throws `AppError` |

**Tests:** all of the above. Persistence uses `fake-indexeddb`; `api-client` uses a mocked `fetch` with a chunked NDJSON body split mid-line. Reducers: every action, plus the invalid transitions (e.g. `stage` while `idle` is ignored).

### Lane C: Media + export

**Owns:** `src/lib/frames.ts`, `src/lib/image.ts`, `src/lib/export-docx.ts`, `src/app/dev/media/page.tsx` (a dev-only test page)

| File | Exports |
|---|---|
| `frames.ts` | `validateFile(file) → void` (type, ≤500 MB; throws `AppError`), `probeVideo(file, {timeoutMs = 8000}) → VideoInfo` (load probe, `Infinity` duration workaround, ≤3:00 check), `createFrameGrabber(blob) → { capture(sec, {signal}) → Blob; dispose() }` (sequential queue, same-time guard, per-seek timeout → `capture_failed`, `requestVideoFrameCallback`), `captureFromVideo(video: HTMLVideoElement) → Blob` (for the frame picker's visible `<video>`) |
| `image.ts` | `encodeFrame(canvas) → Blob` (WebP 0.9, max 1920 px wide, check `blob.type`, JPEG fallback; D3), `renderForExport(shot: Blob, highlight: Rect \| null) → {bytes: Uint8Array, width, height}` (JPEG 0.92, highlight burned in) |
| `export-docx.ts` | `buildDocx(project, getShot: (id) => Promise<Blob \| undefined>) → Blob` (landscape, title, 5-column table; D11), `downloadBlob(blob, filename)` |

**Tests:** jsdom can't decode video, so unit-test only the pure parts (dimension scaling, the `Infinity`-duration branch with a mocked element). The dev page `/dev/media` lets you pick a file, probe it, capture at a few timestamps, and export a fixture project to `.docx`. That's the manual check. Also record the lossless vs lossy WebP comparison here (D3).

### Lane D: App shell + upload flow UI

**Owns:** `src/app/layout.tsx`, `src/app/globals.css`, `src/app/error.tsx`, `src/components/shell/**`, `src/components/upload/**`, `src/components/feedback/**`

| Component | Props |
|---|---|
| `shell/AppHeader` | `{ title?: string; saveStatus: "idle" \| "saving" \| "saved" \| "error"; onStartNew?: () => void; exportSlot?: ReactNode }` |
| `shell/LiveRegion` + `useAnnounce()` | One polite live region in the layout. `announce(msg)` from anywhere |
| `upload/Dropzone` | `{ onFile(file: File): void; disabled?: boolean }`: a real `<button>` + hidden input, drag-over state |
| `upload/EmptyState` | Dropzone + formats/limits + "how it works" + privacy line |
| `upload/JobProgress` | `{ job: Extract<JobState, {phase: "running"}>; fileName: string; sizeBytes: number; onCancel(): void }`: stage list, elapsed time (not announced), indeterminate bar |
| `feedback/ErrorPanel` | `{ error: SerializedAppError; onPrimary(): void; onSecondary?(): void }`: copy from `ERROR_COPY`, focuses its heading on mount (no `role="alert"`; D13) |
| `feedback/Banner` | `{ tone: "warning" \| "info"; children; action?: ReactNode }` (storage full) |
| `app/error.tsx` | Error boundary with "Reload" |

Also sets the **design tokens** (colours, type, focus ring, reduced motion) in `globals.css` from the design canvas. Lane E uses them.
**Storybook-lite:** `src/app/dev/states/page.tsx` renders every component in every state from fixtures. It's the manual and axe check surface.

### Lane E: Editor UI

**Owns:** `src/components/editor/**`, `src/components/frames/**`, `src/components/highlight/**`, `src/app/dev/editor/page.tsx`

| Component | Props |
|---|---|
| `editor/StepList` | `{ steps: Step[]; shotUrls: Record<string, string>; dispatch(a: StepsAction): void; onPickFrame(id): void; onAddStep(afterId: string \| null): void }`: `<ol>` of cards, Add-step affordances, focus management after move/delete (D12) |
| `editor/StepCard` | One step: heading, timestamp button, screenshot + `HighlightEditor`, labelled auto-grow textareas, Move up/down + Delete buttons with `aria-label`s |
| `editor/UndoToast` | `{ deleted: StepsState["lastDeleted"]; onUndo(); onDismiss() }`: no timeout (D12) |
| `editor/NoSteps` | `{ onAddStep(): void }` |
| `editor/ProjectTitle` | `{ value: string; onChange(v): void }`: inline-editable `h1` |
| `editor/ExportButton` | `{ onExport(): Promise<void> }`: busy state, error toast |
| `frames/FramePicker` | `{ open; videoUrl; initialSec; originalSec; durationSec; onConfirm(sec: number, shot: Blob); onCancel() }`: Radix Dialog, visible `<video>`, slider, ±0.1 s/±1 s, latest-seek-wins, uses `captureFromVideo` (Lane C stub) |
| `highlight/HighlightEditor` | `{ imageUrl; alt; highlight: Rect \| null; source; onChange(r: Rect \| null, source: "user"); }`: SVG overlay, pointer drag/resize (rAF, commit on pointer-up), arrows / Shift / Alt / Delete, Add/Remove/Reset buttons. **Timeboxed 30 min** (D9) |

Uses `geometry.ts`, `timestamp.ts` (Lane B stubs) and `stepsReducer` via `useReducer` on the dev page with fixture data. The dev page `/dev/editor` is the manual and axe check surface.

---

## Phase 2: Integration (serial, ≈40 min)

**Owner:** the main session (or one agent), on `main`.

1. Merge lanes in order **B → A → C → D → E**. Ownership is disjoint, so conflicts should only appear in the Phase 0 stub files a lane filled in. Resolve those in favour of the lane.
2. Apply the contract change requests from the lane reports.
3. Write **`src/hooks/useProcessRecorder.ts`**, the only place that connects everything:
   - `onFile`: validate → probe → `saveVideo` → `uploadVideo` (stages → job) → `analyzeVideo` → `stepsFromRaw` → sequential `capture` per step (`captureProgress`, `saveShot`) → `succeed` → focus the results heading.
   - `retry()`: resumes from `retryFrom`. `file_expired` re-uploads from the stored blob.
   - `cancel()`: aborts the one `AbortController`.
   - `startNew()`: confirm → `deleteGeminiFile` → `clearAll` → reset.
   - Restores on mount from `loadAll()`, and autosaves `steps`/`title` through the debounced saver. Exposes `saveStatus`.
   - Owns the object URLs for shots and video (revokes them on replace and unmount).
4. **`src/app/page.tsx`:** a client component that switches on `job.phase` (idle → `EmptyState`, running → `JobProgress`, error → `ErrorPanel`, ready → editor).
5. **End-to-end with the example videos:** the happy path, cancel mid-stage, a bad file of each kind, refresh mid-edit, re-pick, highlight, export, then open the `.docx` in Word.

## Phase 3: Hardening (≈20 min)

Can run in parallel:
- **Review agent:** `/code-review` against the docs (spec) and lint rules.
- **A11y pass:** keyboard-only walkthrough of the demo script. axe on `/`, `/dev/states`, `/dev/editor`. Record the gaps in UX.md "Known gaps".
- **Docs:** mark decisions **Built / Revised** in DECISIONS.md, fill DEBRIEF "Measured numbers" and "Actual", finalise the README (remove the "in development" banner, link the design canvas).

---

## Spawning the lanes

One message, five Agent calls, each with `isolation: "worktree"`. Brief template:

> You are implementing **Lane X: <name>** of Process Recorder. Read `docs/IMPLEMENTATION.md` (ground rules + your lane), then the decisions your lane cites in `docs/DECISIONS.md`, and `docs/UX.md` for UI lanes. Phase 0 contracts are in `src/lib/types.ts` and `src/lib/errors.ts`; your files exist as stubs with fixed signatures. Edit only the files your lane owns. Visual design: <canvas link + relevant artboards> (UI lanes). Finish with the final report described in the ground rules.

**Suggested models:** Lanes D and E (UI judgement, a11y) and Lane A (Gemini edge cases) on the strongest model. Lanes B and C on a faster one.

## Risk register

| Risk | Lane | Mitigation |
|---|---|---|
| Gemini model rejects video/schema | 0, A | The spike runs first. `gemini-2.5-flash` fallback via env |
| shadcn init fails on the Next 16 config | 0 | Fall back to Radix primitives directly |
| Frame capture flaky across codecs | C | Per-seek timeout → `capture_failed` on that step only, so the flow continues |
| Highlight editor overruns | E | 30-minute timebox. Without it, the screenshot still shows the Gemini box read-only |
| Integration overruns | 2 | The dev pages already prove each lane in isolation. Cut highlights from the integrated flow first |
| No example videos yet | 0, 2 | Record a QuickTime screen recording of any web form as a stand-in |
