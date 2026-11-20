# Implementation plan

How the build is split so several agents can work at the same time without stepping on each other.
**This file is the source of truth for contracts** (types, signatures, HTTP behaviour). If ARCHITECTURE.md or DECISIONS.md disagree on a detail, this file wins.

- **Phase 0, Foundation:** serial, main session. Installs everything and writes the **shared contracts**. Also **fully implements the small pure modules** several lanes depend on, so no lane is blocked by another lane's stub.
- **Phase 1, Lanes:** seven agents in parallel, each in its **own git worktree**, each **owning a disjoint set of files**.
- **Phase 2, Integration:** serial. Each lane has already merged through its PR review loop. Run E2E and the live videos, then fix.
- **Phase 3, Hardening:** review, a11y pass, docs.

```
Phase 0 ──► ┌ A  Server + Gemini (+ spike) ─┐
 (≈40 min)  ├ B  Persistence + API client ──┤
            ├ C  Media, frame picker, export┤
            ├ D  Shell, upload, feedback UI ┼──► Phase 2 ──► Phase 3
            ├ E  Step editor + highlights ──┤    (≈45 min)   (≈15 min)
            ├ F  Orchestrator hook + page ──┤
            └ G  E2E tests + CI ────────────┘
                  (≈60 min; report at 50)
```

**Example videos** (gitignored, not in worktrees, so always use the absolute path): `/Users/celsaad/projects/interviews/glasslake/samples/`

| File | Length | Resolution | Use |
|---|---|---|---|
| `po-to-gr-compressed.mp4` | 1:48 | 1296×720, 3 MB | Small and fast: local checks, `curl` (E2E uses Lane G's generated `tiny.webm`) |
| `j45-pr-po-si.mp4` | 2:44 | 1920×1080, 7 MB | Happy path |
| `j45-pr.mov` | 2:25 | 3456×1990, 76 MB | QuickTime `.mov`, Retina (tests the 1920 px cap and large uploads) |
| `oracle-fusion-pr-to-po.mp4` | 3:33 | 1920×1080, 9 MB | Over 3:00: **long-video notice** (D16) |
| `oracle-pr-to-po-long.mp4` | 5:26 | 1280×720, 12 MB, Opus audio | Over 3:00: **long-video notice** (D16) |

Total ≈ 160 min of the 180, leaving 20 minutes of slack.

Decisions D1–D15 are in [DECISIONS.md](DECISIONS.md). Screen states and keyboard flow are in [UX.md](UX.md). Visual design: [Claude Design canvas](https://claude.ai/artifact/UpCBEnL2FUav7hRbM3Njey).

---

## Ground rules for every lane agent

1. **Setup in your worktree:** run `pnpm install --frozen-lockfile` first. Lanes A and F also run `cp /Users/celsaad/projects/interviews/glasslake/.env.local .` (never commit it). If you run the dev server, use **your lane's port** (A 3001, B 3002, C 3003, D 3004, E 3005, F 3006, G 3007): `pnpm dev -p <port>`.
2. **Only edit files your lane owns.** Need a change elsewhere (a contract, another lane's file, `src/components/ui/**`, `globals.css` token *names*)? Don't make it. List it under "Contract change requests" in your report.
3. **Don't add dependencies.** Everything is installed in Phase 0. Report a missing one instead.
4. **Next.js 16 has breaking changes.** Read the relevant guide in `node_modules/next/dist/docs/` before writing route handlers or app files. **Never create `proxy.ts`** (D2). `next dev` may rewrite `AGENTS.md`. Leave that change out of your commits.
5. **Code against the contracts in Phase 0 files, not against guesses.** Functions that are still stubs (they throw `not implemented`) must be mocked in your tests (`vi.mock`) and faked on your dev pages (`src/fixtures/fakes.ts`).
6. **Work in your lane's priority order.** At about **50 minutes, stop, commit and report**, even if items remain. A committed partial lane beats an uncommitted complete one.
7. **Definition of done:** `pnpm check` passes (typecheck, lint, test). Your lane's rows in the [testing strategy](#testing-strategy) tables are implemented. Tests live next to the code (`*.test.ts(x)`). Lint disables are allowed only with a one-line justification comment.
8. **Verification without a browser:** prove behaviour with unit tests, `curl` (Lane A), or by rendering the dev page with `pnpm build` passing. Visual and keyboard checks happen in Phase 2.
9. **Final report (≤300 words):** branch name, what's built, what's stubbed or broken, contract change requests, contradictions with the docs.
10. Pure logic in `src/lib/` must not import React or Next.

---

## Phase 0: Foundation (serial, ≈40 min)

**Owner:** main session, committed to `main` **before any lane is spawned**.

### 0.1 Tooling (≈10 min)
- **Runtime deps:** `@google/genai`, `zod`, `idb-keyval`, `docx`, `lucide-react`.
- **Dev deps:** `vitest`, `jsdom`, `fake-indexeddb`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `vitest-axe`, `@playwright/test`, `@axe-core/playwright`. Run `pnpm exec playwright install chromium` in the background.
- **shadcn:** `shadcn init`, then add `button`, `textarea`, `label`, `dialog`, `alert-dialog`, `slider`, `tooltip`, `sonner`, `skeleton`, `badge`. **Timebox 5 min**, else fall back to Radix primitives. `src/components/ui/**` is **frozen** after Phase 0.
- **Scripts:** `test` (`vitest run`), `test:watch`, `typecheck` (`tsc --noEmit`).
- **`vitest.config.ts`:** the `@/` alias, `environment: "node"` by default, with `// @vitest-environment jsdom` per file where needed. A setup file (`vitest.setup.ts`) registers `jest-dom` and `vitest-axe` matchers. Playwright's `e2e/` folder is excluded.
- **Scripts:** add `test:e2e` (`playwright test`) and `check` (`typecheck && lint && test`).
- **Exclude worktrees:** add `.claude/` to `.gitignore`, `tsconfig.json` `exclude`, the eslint ignores and the vitest `exclude`. Agent worktrees may live inside the repo, and must not be type-checked, linted or tested from `main`.

### 0.2 Contracts (≈10 min)
`src/lib/types.ts`, `src/lib/ui-contracts.ts` and `src/lib/errors.ts`, exactly as below.

### 0.3 Real implementations + tests (≈15 min)
These are small, pure, and needed by several lanes, so they are written *for real*, not stubbed:

| File | Exports |
|---|---|
| `lib/timestamp.ts` | `parseTimestamp(s): number \| null` accepts `SS`, `M:SS`, `MM:SS`, `MM:SS.s`, `H:MM:SS` and rejects anything else. `formatTimestamp(sec, precision: 0 \| 1 = 0)` → `"1:05"` / `"1:05.3"`. `formatBytes(n)` → `"640 MB"` |
| `lib/geometry.ts` | `box2dToRect(box: number[]): Rect \| null` (`null` unless length 4, in range, non-degenerate), `clampRect`, `moveRect(r, dx, dy)`, `resizeRect(r, dw, dh)`, `MIN_RECT` |
| `lib/schema.ts` | zod: `GeminiResponseSchema` (accepts `box_2d` of length 0 or 4; any other length becomes `[]` rather than failing the response), `UploadEventSchema`, `AnalyzeResponseSchema` |
| `lib/limits.ts` | `SOFT_DURATION_SEC = 180`, `MAX_DURATION_SEC = 600`, `MAX_BYTES = 500 * 1024 ** 2`, `ACCEPTED_TYPES`, `isLongVideo(sec)` (D16). Used by the client and the server |
| `lib/steps.ts` | `createStep(partial, timestampSec): Step` (`crypto.randomUUID()`), `stepsFromRaw(raw: RawStep[], durationSec): Step[]` (clamp to duration, `captureState: "pending"`, `highlight = suggestedHighlight = box`, `highlightSource: box ? "gemini" : null`) |
| `components/shell/LiveRegion.tsx` | `LiveRegionProvider` + `useAnnounce(): (msg: string) => void`. Mounted in `layout.tsx` |
| `app/layout.tsx` | Mounts `LiveRegionProvider`, `<Toaster />`, `TooltipProvider`, and the Inter font |
| `app/globals.css` | **Token names** (shadcn semantic: `--background`, `--foreground`, `--primary`, `--muted`, `--destructive`, `--ring`, plus `--highlight`) with placeholder values, a focus-ring utility, and a `prefers-reduced-motion` reset. Lane D changes **values only** |

### 0.4 Stubs + fixtures (≈5 min)
- **Every other `lib/` and `server/` file** gets its exact signatures with `throw new Error("not implemented")` bodies.
- **Every component** in the lane tables gets a one-line stub, `export function X(props: XProps) { return null }`, with props from `ui-contracts.ts`. Lane F's page then type-checks against the real props before the merge.
- **`src/fixtures/project.ts`:** a 4-step "Create a purchase order" project with realistic copy.
- **`src/fixtures/shots/*.webp`:** generated by `scripts/make-fixture-shots.mjs` (simple drawn form images, 1600×1000).
- **`src/fixtures/fakes.ts`:** in-memory fakes for `persistence`, `api-client` and `frames` (with delays), used by dev pages and Lane F.
- **`src/fixtures/http/`:** **contract fixtures**, hand-written examples of every wire shape: `upload-happy.ndjson`, `upload-too-large.ndjson`, `analyze-ok.json`, `analyze-no-steps.json`, `analyze-rate-limited.json`, `analyze-not-screen-recording.json`. Lane A's route tests assert their output matches these shapes. Lane B's client tests parse these exact files. Both sides test against the same examples, so they agree at integration.

Commit, push, then spawn the lanes.

### `src/lib/types.ts`

```ts
// ---------- Domain ----------
export type Rect = { x: number; y: number; w: number; h: number }; // normalized 0–1

export type CaptureState = "pending" | "ok" | "failed";
export type HighlightSource = "gemini" | "user" | null;

export type Step = {
  id: string;
  action: string;
  description: string;
  expectedResult: string;
  timestampSec: number;
  captureState: CaptureState;
  highlight: Rect | null;
  highlightSource: HighlightSource;
  suggestedHighlight: Rect | null; // Gemini's box for this step's original frame; enables "Reset to suggestion"
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

// ---------- HTTP contract (D4) ----------
export type UploadStage = "received" | "sending_to_gemini" | "gemini_processing";

export type UploadEvent =
  | { type: "stage"; stage: UploadStage }
  | { type: "ready"; fileName: string; mimeType: string }
  | { type: "error"; error: SerializedAppError };

export type RawStep = {            // server output: sorted, de-duplicated, box converted
  action: string;
  description: string;
  expectedResult: string;
  timestampSec: number;
  box: Rect | null;
};

export type AnalyzeResponse =
  | { ok: true; processTitle: string; steps: RawStep[] }   // steps may be [] → NoSteps UI, not an error
  | { ok: false; error: SerializedAppError };

// ---------- Errors (D10) ----------
export type ErrorKind =
  | "missing_api_key" | "unsupported_type" | "too_long" | "too_large" | "undecodable"
  | "network" | "rate_limited" | "gemini_failed" | "gemini_blocked" | "bad_model_output"
  | "file_expired" | "not_screen_recording" | "capture_failed" | "storage_full" | "cancelled";

/** `detail` is display-ready text produced by whoever raises the error,
 *  e.g. too_long → "12:40", too_large → "640 MB", unsupported_type → ".pdf",
 *  not_screen_recording → the model's rejectionReason. */
export type SerializedAppError = { kind: ErrorKind; detail?: string };

// ---------- Job state machine (D7) ----------
export type JobStage = "validating" | UploadStage | "analyzing" | "capturing";
export type RetryFrom = "upload" | "analyze" | "capture";

export type JobState =
  | { phase: "idle" }
  | { phase: "running"; stage: JobStage; stageStartedAt: number; completed: JobStage[];
      capture?: { done: number; total: number } }
  | { phase: "ready" }
  | { phase: "error"; error: SerializedAppError; retryFrom: RetryFrom | null };

export type JobAction =
  | { type: "start"; at: number }                    // idle|error|ready → running(validating)
  | { type: "stage"; stage: JobStage; at: number }   // running → running
  | { type: "captureProgress"; done: number; total: number }
  | { type: "succeed" }                              // running → ready
  | { type: "restore" }                              // idle → ready (project loaded from IndexedDB)
  | { type: "fail"; error: SerializedAppError; retryFrom: RetryFrom | null }
  | { type: "cancel" }                               // running → idle
  | { type: "reset" };                               // any → idle

// ---------- Steps reducer (D7, D12) ----------
export type StepsState = { steps: Step[]; lastDeleted: { step: Step; index: number } | null };

export type StepsAction =
  | { type: "load"; steps: Step[] }
  | { type: "update"; id: string; patch: Partial<Pick<Step, "action" | "description" | "expectedResult">> }
  | { type: "add"; afterId: string | null; step: Step }      // caller builds the step with createStep()
  | { type: "remove"; id: string }                           // keeps the shot in IndexedDB so undo works
  | { type: "undoRemove" }
  | { type: "dismissUndo" }
  | { type: "move"; id: string; direction: "up" | "down" }
  | { type: "setTimestamp"; id: string; timestampSec: number } // re-pick: clears highlight AND suggestedHighlight if source was "gemini" (D9)
  | { type: "setCaptureState"; id: string; captureState: CaptureState }
  | { type: "setHighlight"; id: string; highlight: Rect | null; source: HighlightSource };

// ---------- Orchestrator (Lane F) ----------
export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type Recorder = {
  job: JobState;
  project: Project | null;
  steps: StepsState;
  dispatch: (a: StepsAction) => void;
  shotUrls: Record<string, string>;     // stepId → object URL (hook owns the lifecycle)
  videoUrl: string | null;              // object URL of the stored video (hook owns it)
  saveStatus: SaveStatus;
  storageFull: boolean;
  onFile: (file: File) => void;         // asks "Replace current project?" if one exists
  retry: () => void;
  cancel: () => void;
  startNew: () => void;                 // opens the confirm; confirmStartNew() does the work
  confirmStartNew: () => Promise<void>;
  pendingConfirm: "start_new" | "replace" | null;
  pendingFileName: string | null;       // the file awaiting the replace confirm (added in follow-ups #11)
  resolveConfirm: (ok: boolean) => void;
  setTitle: (t: string) => void;
  repick: (stepId: string, sec: number, shot: Blob) => Promise<void>;
  addStep: (afterId: string | null) => Promise<void>; // captures a frame at prev.timestamp + 1 s
  exportDocx: () => Promise<void>;
};
```

### `src/lib/errors.ts`

```ts
export class AppError extends Error { kind: ErrorKind; detail?: string }
export function toAppError(e: unknown): AppError;   // AbortError → cancelled, fetch TypeError → network, QuotaExceededError → storage_full
export function serialize(e: AppError): SerializedAppError;
export const ERROR_COPY: Record<ErrorKind, {
  title: string;
  body: (detail?: string) => string;
  primaryAction: "choose_file" | "retry" | "export" | "none";
  retryFrom: RetryFrom | null;  // where Retry resumes; file_expired → "upload"
}>;
```

### `src/lib/ui-contracts.ts`
Props types for every component in the lane tables below, plus `export const RESULTS_HEADING_ID = "results-heading"` (the focus target after capture finishes, D13).

### HTTP behaviour (Lane A implements it, Lane B consumes it)
- **The client never branches on the HTTP status. It always parses the body as the contract shape.** Statuses are set for correctness and logs.
- `POST /api/upload`: response is **always `application/x-ndjson`**.
  - Rejections before streaming (`missing_api_key` 500, `too_large` 413, `unsupported_type` 415) send a single `{"type":"error",…}` line.
  - Otherwise the status is 200, then stage events, ending in `ready` or `error`.
- `POST /api/analyze` `{ fileName }`: the body is always an `AnalyzeResponse`. Statuses: 200 for `ok: true`; 404 `file_expired`, 429 `rate_limited`, 422 `bad_model_output` / `gemini_blocked` / `not_screen_recording`, 500 for other errors.
- `DELETE /api/file?name=<fileName>` → 204. Best effort: the client ignores failures.
- `fileName` must match `^files/[a-z0-9-]+$`, otherwise 400 (D4).

---

## Phase 1: Lanes (parallel, ≈60 min; report at 50)

Each lane: one agent, `isolation: "worktree"`. The list order within each lane is the priority order.

### Lane A: Server + Gemini (D4, D5, D10)
**Owns:** `src/server/**`, `src/app/api/**`, `src/lib/normalize.ts` (+ tests), `src/server/__fixtures__/**`

1. **Spike (15 min):** confirm `GEMINI_MODEL` handles video + `RESPONSE_SCHEMA`, `video/quicktime` works, piping `request.body` to a temp file works, and `request.signal` aborts on disconnect. Put the findings in your report (the main session updates D4/D5). Save one real response to `src/server/__fixtures__/gemini-response.json`.
2. `server/prompt.ts`: `PROMPT`, `RESPONSE_SCHEMA` (all fields required, `propertyOrdering`, `box_2d` integer array, `MM:SS` timestamps just before each action, `isScreenRecording`/`rejectionReason`).
3. `server/gemini.ts`: `getClient()`, `uploadAndWait(path, mimeType, signal)` (2 min poll timeout), `generateSteps(fileName, signal)` (`finishReason` checks, zod, one retry with the error fed back, low thinking), `deleteFile(fileName)`, `classifyGeminiError(e): AppError`.
4. `lib/normalize.ts`: `normalizeSteps(parsed): RawStep[]`: `parseTimestamp`, sort, nudge duplicates by +0.5 s, `box2dToRect`.
5. Routes: `api/upload`, `api/analyze`, `api/file`, following the HTTP behaviour above.
6. **Fake Gemini mode** (`server/gemini-fake.ts`). When `GEMINI_FAKE=1`, `gemini.ts` delegates to the fake: no network, short delays, responses built from `__fixtures__/gemini-response.json`. The scenario comes from a `fake-scenario` cookie, which is ignored unless `GEMINI_FAKE=1`. Scenarios: `happy` (default), `no_steps`, `not_screen_recording`, `rate_limited`, `bad_model_output`, `gemini_failed`, `slow` (10 s per stage, for cancel tests). Lane G's E2E tests and CI depend on this.

**Tests:** unit tests and route tests per the [testing strategy](#testing-strategy). **Check:** `curl` each endpoint with `samples/po-to-gr-compressed.mp4`, once for real and once with `GEMINI_FAKE=1`.

### Lane B: Persistence + API client (D4, D8)
**Owns:** `src/lib/persistence.ts`, `src/lib/api-client.ts` (+ tests)

1. `api-client.ts`: `uploadVideo(file, {signal, onStage}) → {fileName, mimeType}` (streaming NDJSON reader that tolerates chunks split mid-line, validated with `UploadEventSchema`), `analyzeVideo(fileName, {signal}) → {processTitle, steps}`, `deleteGeminiFile(fileName)`. Throws `AppError`. A network failure gives `network`, an abort gives `cancelled`.
2. `persistence.ts` (D8 split keys): `loadAll() → {project, video} | null`, `saveProjectNow(p)`, `createDebouncedSaver({ ms = 500, onStatus, onError }) → {schedule(p), flush(), cancel()}`, `saveVideo(blob)`, `saveShot(id, blob)`, `loadShot(id)`, `clearAll()`. `QuotaExceededError` → `onError(AppError("storage_full"))`. `flush()` is what the `pagehide` handler calls.

**Tests:** `api-client` with a mocked `fetch` and chunked bodies, covering every error path. Persistence with `fake-indexeddb`. If `Blob`s don't round-trip there, assert keys and sizes, or store `ArrayBuffer`.

### Lane C: Media, frame picker, export (D3, D6, D11)
**Owns:** `src/lib/frames.ts`, `src/lib/image.ts`, `src/lib/export-docx.ts`, `src/components/frames/**`, `src/app/dev/media/page.tsx`

1. `frames.ts`:
   - `validateFile(file)` (type and ≤500 MB; throws `AppError` with display-ready `detail`).
   - `probeVideo(file, {timeoutMs = 8000}) → VideoInfo` (load probe, `Infinity`-duration workaround, `> MAX_DURATION_SEC` → `too_long`; D16).
   - `createFrameGrabber(blob) → { capture(sec, {signal}) → Blob; dispose() }` (sequential queue, same-time guard, per-seek timeout → `capture_failed`, `requestVideoFrameCallback`).
   - `captureFromVideo(video) → Blob`.
2. `image.ts`: `encodeFrame(canvas) → Blob` (WebP 0.9, ≤1920 px wide, check `blob.type`, JPEG fallback), `renderForExport(shot, highlight) → {bytes, width, height}` (JPEG 0.92, highlight burned in).
3. `frames/FramePicker.tsx`: Radix Dialog, visible `<video>` (preview capped at `max-height: 50vh`), Radix slider (Shift = larger steps; the original-timestamp marker offset for the thumb inset), hint "← → step · Shift for 1 s · Enter to use · Esc to cancel", ±0.1 s/±1 s buttons, the latest seek wins, the original timestamp marked, Enter/Esc, focus returns to the trigger. Confirm → `onConfirm(sec, await captureFromVideo(video))`.
4. `export-docx.ts`: `buildDocx(project, steps, getShot) → Blob` (landscape, title, 5-column table), `downloadBlob(blob, filename)`, `exportFilename(title)` → `"create-a-purchase-order.docx"`.
5. `/dev/media`: pick a file → probe → capture at 3 timestamps → open the FramePicker → export the fixture project. Also record the lossless vs lossy WebP sizes (D3) if time allows.

**Tests:** the pure parts (scaling, filename, `Infinity` branch with a mocked element).

### Lane D: Shell, upload and feedback UI (D10, D13, UX.md)
**Owns:** `src/app/globals.css` (token values only), `src/app/error.tsx`, `src/components/shell/**` (except `LiveRegion.tsx`), `src/components/upload/**`, `src/components/feedback/**`, `src/components/project/**`, `src/app/dev/states/page.tsx`

1. **Token values** from the design canvas, in `globals.css`.
2. `shell/AppHeader` `{ saveStatus; onStartNew?; title?; actions? }` (explicit slots; were positional children until follow-ups #11). **Sticky** in the editor, so Export and the save status stay visible with 20+ steps.
3. `upload/Dropzone` `{ onFile; disabled? }` and `upload/EmptyState` `{ onFile }` (formats, limits, how it works, privacy line).
4. `upload/JobProgress` `{ job: running JobState; video: VideoInfo; onCancel }` (stage list, elapsed time not announced, indeterminate bar, plus the long-video notice when `isLongVideo(video.durationSec)`; D16) and `upload/CaptureBanner` `{ done; total }` (the compact banner shown above the editor while capturing).
5. `feedback/ErrorPanel` `{ error; onPrimary; onSecondary?; children? }` (copy from `ERROR_COPY`, `h1` heading focused on mount, no `role="alert"`; `children` is an extra detail area, e.g. Gemini's reason or "Your video is already uploaded. Retry won't upload it again."), `feedback/Banner` `{ tone: "warning" | "info"; children; action? }` (info tone = the long-video notice; no `role` of its own, announcements go through `useAnnounce`), `feedback/ConfirmDialog` `{ open; kind: "start_new" | "replace"; onResolve(ok); projectTitle?; fileName? }` (alert-dialog; names the project and file). Focus returns to the opener, else to the results heading. A dropped file has no opener, so the heading is the intended target.
6. `project/ProjectTitle` `{ value; onChange }` (a **visible** `h1` with `id={RESULTS_HEADING_ID}` and `tabIndex={-1}` showing the title, plus a "Rename" icon button that swaps in a labelled input; Enter saves, Esc cancels), `project/ExportButton` `{ onExport(): Promise<void> }` (busy state + error toast), `project/NoSteps` `{ onAddStep }`.
7. `app/error.tsx` and `/dev/states` (every component in every state, from fixtures).

### Lane E: Step editor + highlights (D9, D12, D13)
**Owns:** `src/lib/steps-reducer.ts` (+ tests), `src/components/editor/**`, `src/components/highlight/**`, `src/app/dev/editor/page.tsx`

1. `steps-reducer.ts`: `stepsReducer`, `initialSteps`. Tests for every action, including the `setTimestamp` highlight-clearing rule and undo restoring at the original index.
2. `editor/StepCard` `{ step; index; total; shotUrl?; onChange(patch); onMove(dir); onDelete; onPickFrame; onHighlightChange(r, source) }`: heading "Step N", timestamp button (opens the picker), screenshot (max 320 px tall) with a skeleton while `pending` and a placeholder + "Pick frame" when `failed`, `alt="Screenshot for step N"`, labelled auto-grow textareas (no resize handle). **Action row:** Pick frame, Add / Remove highlight, Reset to suggestion (only when `suggestedHighlight` exists), Move up, Move down, Delete. Every accessible name includes "for step N" / "step N", and visible text is a prefix of the name (label-in-name). Move buttons at the ends use **`aria-disabled="true"`, not `disabled`**, so focus isn't lost after moving a step to the top.
3. `editor/StepList` `{ steps; lastDeleted; shotUrls; dispatch; onPickFrame(id); onAddStep(afterId) }`: `<ol>`, "Add step" affordances (named "Add step after step N"), focus management after move/delete (D12), announcements via `useAnnounce`. Renders the `DeletedStepRow` inline at `lastDeleted.index`.
4. `editor/DeletedStepRow` `{ deleted; onUndo; onDismiss }`: an inline row where the deleted card was, "Step 3 deleted · Undo · Dismiss". No timeout. Replaced by the next delete. **Not** a floating toast: a toast sits last in the DOM, dozens of Tabs away (D12).
5. `highlight/HighlightEditor` `{ imageUrl; alt; stepNumber; highlight; suggested; onChange(r: Rect | null) }`: edited **in place inside the card** (no separate surface). SVG overlay named "Highlight on step N screenshot" with key instructions in `aria-describedby`. **4 corner handles** (drawn 14 px, 24 px hit area). Pointer drag/resize (rAF, commit on pointer-up), arrows / Shift / Alt / Delete. The Add / Remove / Reset buttons live in StepCard's action row. **Timebox 30 min**. If it runs over, ship a read-only overlay + Remove button.
6. `/dev/editor`: fixture project + real reducer + fixture shots.

### Lane F: Orchestrator hook + page (D7, D8, D10)
**Owns:** `src/lib/job-machine.ts` (+ tests), `src/hooks/**`, `src/app/page.tsx`

1. `job-machine.ts`: `jobReducer`, `initialJob`. Tests for every valid transition. Invalid ones are ignored.
2. `hooks/useProcessRecorder.ts` returns a `Recorder`:
   - **onFile:** confirm "replace" if a project exists → `validateFile` → `probeVideo` → `saveVideo` → `uploadVideo` (stages) → `analyzeVideo` → `stepsFromRaw` → **persist the project for the first time** → sequential capture (`captureProgress`, `saveShot`, `setCaptureState`) → `succeed` → focus `RESULTS_HEADING_ID` → announce "N steps ready". If there are zero steps, still `succeed`, and the page shows `NoSteps`.
   - **retry:** uses `ERROR_COPY[kind].retryFrom` / `job.retryFrom`. `file_expired` → re-upload from the stored video blob.
   - **cancel:** aborts the single `AbortController` → announce "Cancelled".
   - **startNew:** confirm → `deleteGeminiFile` → `clearAll` → revoke URLs → reset.
   - **On mount:** `loadAll()` → `restore` + announce "Restored your last project". Load shots into object URLs.
   - **Autosave:** steps and title go through the debounced saver (`saveStatus`, `storageFull`), and `pagehide` calls `flush()`.
   - **repick / addStep / exportDocx** as typed in `Recorder`.
   - Owns and revokes every object URL.
3. `app/page.tsx` (client): idle → `EmptyState`. running and not capturing → `JobProgress`. running(capturing) or ready → editor (header, `ProjectTitle`, `CaptureBanner` while capturing, `StepList` or `NoSteps`, `FramePicker`). error → `ErrorPanel`. `ConfirmDialog` is driven by `pendingConfirm`. The storage-full `Banner` is shown when needed.

**Tests:** the hook with `vi.mock` of `persistence`, `api-client` and `frames` (or the fakes): the happy path, cancel mid-upload, analyze failure → retry without re-upload, restore on mount.

### Lane G: End-to-end tests + CI
**Owns:** `e2e/**`, `playwright.config.ts`, `.github/workflows/ci.yml`

Written in parallel **against UX.md and the demo script, not against code**. Use role/label selectors only (`getByRole`, `getByLabel`): these double as a check that the UI is accessible, and they don't depend on how other lanes structure their markup. The specs run for real in Phase 2.

1. `playwright.config.ts`: Chromium only. `webServer` runs `pnpm build && pnpm start -p 3100` with `GEMINI_FAKE=1`. Traces kept on failure.
2. `e2e/helpers.ts`: `useScenario(page, name)` sets the `fake-scenario` cookie, `uploadSample(page, file)`, `expectNoAxeViolations(page)` (`@axe-core/playwright`, WCAG 2.2 AA tags).
3. Specs, in priority order:
   - `happy-path.spec.ts`: upload `e2e/fixtures/tiny.webm` → stages appear → steps with screenshots → edit a field → Export → a `.docx` download event with the right filename.
   - `errors.spec.ts`: a PDF is rejected as `unsupported_type` before upload. The `rate_limited` scenario → Retry does **not** re-upload (assert no second `/api/upload` request). Also `not_screen_recording` and `no_steps` → the NoSteps UI.
   - `persistence.spec.ts`: edit → wait for "Saved" → reload → the edit and screenshots are still there. Start new → confirm → empty state.
   - `keyboard.spec.ts`: the whole flow with the keyboard only: choose the file via the dropzone button, move a step, delete it and Undo, open the frame picker and step with the arrow keys, Enter to confirm. Assert focus lands on the results heading after capture.
   - `a11y.spec.ts`: axe scans on the empty, processing (the `slow` scenario), ready, error and frame-picker-open states.
   - `cancel.spec.ts`: the `slow` scenario → Cancel → back to the empty state, with the "Cancelled" announcement in the live region.
   - `live.spec.ts`, tagged `@live` and **skipped unless `GEMINI_LIVE=1`**: one real Gemini run on `j45-pr-po-si.mp4` that asserts at least 3 steps, all with timestamps inside the video. Run manually, never in CI.
4. `.github/workflows/ci.yml`: on push/PR: `pnpm install --frozen-lockfile` → `pnpm check` → install Playwright chromium → `pnpm test:e2e` (fake Gemini, no secrets needed). The sample videos aren't in git (and shouldn't be: they're the interviewer's material). Instead, Lane G **generates its own fixture**: `e2e/generate-fixture.ts` uses Playwright's `recordVideo` to record a scripted fictional form being filled in (about 20 s, WebM/VP8, which Chromium decodes) and commits it as `e2e/fixtures/tiny.webm` (≤1 MB). The E2E specs use that clip. `po-to-gr-compressed.mp4` is used only locally and in the `@live` spec. (`ffmpeg` isn't installed, so cutting a clip from a sample wasn't an option.)

---

## Testing strategy

Five layers. Each runs at a different time, and each catches a different class of bug.

| Layer | Tool | Runs | Written by | Catches |
|---|---|---|---|---|
| **1. Unit** | Vitest (node) | `pnpm test`, every commit | Phase 0 + each lane, next to the code | Logic bugs in pure functions and reducers |
| **2. Component** | Vitest + Testing Library + `vitest-axe` (jsdom) | `pnpm test` | Lanes C, D, E | Wrong labels and focus, broken keyboard handling, a11y violations per component |
| **3. Route / contract** | Vitest calling the route `POST()` with a `Request`; Gemini mocked | `pnpm test` | Lane A (server side), Lane B (client side), both against `src/fixtures/http/` | Server and client disagreeing on the wire format, status codes, limits |
| **4. End-to-end** | Playwright + axe, fake Gemini | `pnpm test:e2e`, CI | Lane G | Integration bugs, real browser video decoding, persistence across reloads, whole-page a11y |
| **5. Live + manual** | `@live` spec, dev pages, Word | By hand in Phase 2 | — | Model quality, timestamp drift, how the docx looks in Word |

### Unit tests (layer 1): required cases

Every pure module gets a `*.test.ts` beside it. These cases are the minimum. A lane isn't done until they pass.

| Module | Owner | Must cover |
|---|---|---|
| `timestamp.ts` | Phase 0 | `"0:00"`, `"1:05"`, `"01:05"`, `"1:05.5"`, `"1:02:03"`, `"65"`. Rejects `""`, `"1:5"`, `"abc"`, `"1:65"`, negatives. `formatTimestamp` rounding at both precisions. `formatBytes` boundaries (999 KB, 1 MB, 1.5 GB) |
| `geometry.ts` | Phase 0 | `box2dToRect`: valid box, axis order `[ymin, xmin, ymax, xmax]`, out of range, length ≠ 4, zero area, inverted. `clampRect` at every edge. `moveRect` / `resizeRect` stay in bounds and respect `MIN_RECT` |
| `schema.ts` | Phase 0 | A valid response passes. A missing required field fails. `box_2d` of length 3 becomes `[]` without failing the response. Extra fields are stripped. Each `UploadEvent` variant parses, and unknown types fail |
| `steps.ts` | Phase 0 | `createStep` ids are unique. `stepsFromRaw` clamps to the duration, sets `pending`, and copies `box` to both `highlight` and `suggestedHighlight` with source `"gemini"` |
| `errors.ts` | Phase 0 | `toAppError`: `AbortError` → `cancelled`, `TypeError("Failed to fetch")` → `network`, `QuotaExceededError` → `storage_full`, unknown → `gemini_failed`. Every `ErrorKind` has copy and a `retryFrom` (exhaustive test) |
| `normalize.ts` | A | Sorts out-of-order steps. Nudges duplicates by +0.5 s (and three-way duplicates). Drops steps with unparseable timestamps. Converts boxes. Empty input → `[]` |
| `server/gemini.ts` (`classifyGeminiError`) | A | 429 → `rate_limited`, 404 → `file_expired`, 5xx → `gemini_failed`, `finishReason` `MAX_TOKENS` → `bad_model_output`, `SAFETY` → `gemini_blocked`, missing key → `missing_api_key` |
| `api-client.ts` | B | NDJSON split mid-line and across chunks. Several events in one chunk. Stages are reported in order. An `error` event throws an `AppError`. A non-200 response with an NDJSON body still parses. Abort → `cancelled`. `fetch` rejects → `network`. Malformed JSON → `bad_model_output` |
| `persistence.ts` | B | Round-trips the project, video and shot keys. The debounced saver writes once for a burst of `schedule` calls. `flush` writes immediately. `onStatus` order is saving → saved. A quota error → `onError(storage_full)`. `clearAll` empties everything |
| `job-machine.ts` | F | Every valid transition from the `JobAction` comments. Invalid ones return the **same state object**. `completed` accumulates stages. `fail` keeps `retryFrom` |
| `steps-reducer.ts` | E | `update`. `add` after a given id and at the start. `remove` → `undoRemove` restores at the original index. `move` at the ends does nothing. `setTimestamp` clears a gemini highlight but keeps a user one. `setHighlight`. A `load` replaces everything |
| `image.ts` (pure helpers) | C | The scale-to-fit calculation (Retina 3456 → 1920, already small → unchanged). Rect → pixel conversion for burning in the highlight |
| `frames.ts` (pure helpers) | C | The `Infinity`-duration path with a mocked element. `validateFile` type and size messages (`detail` = ".pdf" / "640 MB") |
| `export-docx.ts` | C | `exportFilename` slugging (spaces, unicode, empty → `"test-script.docx"`). The table-row mapping: 5 columns, step order, a missing shot gives a placeholder cell |

### Component tests (layer 2)

jsdom + Testing Library + `user-event`. Each test file ends with `expect(await axe(container)).toHaveNoViolations()`.

| Component | Owner | Must cover |
|---|---|---|
| `Dropzone` | D | It's a button. Enter/Space opens the file input. A drop calls `onFile`. `disabled` blocks both |
| `JobProgress` | D | Completed/active/pending stages are marked (not by colour alone). Cancel calls `onCancel`. The elapsed time is outside the live region |
| `ErrorPanel` | D | The `h1` gets focus on mount. Copy comes from `ERROR_COPY` with `detail` filled in. `children` render in the detail area. No `role="alert"` |
| `ConfirmDialog` | D | Focus is trapped, Esc resolves `false`, and focus returns to the trigger |
| `StepCard` | E | Every textarea has a label. Icon buttons have names that include the step number. Move up has `aria-disabled` on the first step (still focusable; activating it does nothing), Move down on the last. Visible label is a prefix of the accessible name. Reset is shown only when there's a suggestion. `alt="Screenshot for step N"` |
| `StepList` | E | After a move, focus is on the moved step's button. After a delete, focus is on the inline row's Undo (D12). Moves and deletes are announced. Each heading has `id={stepHeadingDomId(N)}` |
| `DeletedStepRow` / `StepList` | E | The row renders at the deleted index. No auto-dismiss (advance fake timers 60 s, still visible). After delete, focus is on the row's Undo button. Undo restores the step and focuses its heading. Dismiss focuses the next step (previous if last) |
| `HighlightEditor` | E | Arrows move by 1%, Shift by 10%, Alt resizes, Delete removes. Name is "Highlight on step N screenshot" with instructions via `aria-describedby`. 4 handles |
| `FramePicker` | C | Arrow and Shift+arrow on the (Radix) slider change the time. Enter on the slider confirms, Enter on a ± button only steps. Esc cancels. Focus returns (video capture mocked) |
| `useProcessRecorder` | F | Covered in the Lane F tests (hook tests with mocks) |

### Route / contract tests (layer 3)

- **Lane A** imports `POST` from each `route.ts`, calls it with a constructed `Request`, and mocks `server/gemini.ts`. It checks the status codes and body shapes from the HTTP behaviour section, a bad `fileName` → 400, an oversized `Content-Length` → 413 NDJSON error, a missing key → 500 NDJSON error, and that the temp file is deleted on success and on failure.
- **Lane B** feeds the `src/fixtures/http/*` files to `api-client` via a mocked `fetch`.
- Both lanes test against the same fixture files, so a mismatch shows up as a failing test in one lane instead of a surprise at integration.

### What is deliberately not tested
- Real video decoding and frame capture in jsdom (impossible): covered by Playwright with the real sample, plus the `/dev/media` page.
- Gemini output quality: covered by the `@live` spec and the DEBRIEF measurements, not by assertions.
- Visual regression (screenshots): not worth it in 3 hours.

---

## Phase 2: Integration (serial, ≈45 min)

1. By now every lane PR has merged through the review loop (see "Shipping each lane"). Confirm `main` is green with `pnpm check` and `pnpm build`.
2. Apply the contract change requests and the spike findings (update D4/D5).
3. **`pnpm test:e2e`** (fake Gemini). Fix failures until it's green. A failing spec is either a real bug or a spec that guessed the UI wrong; fix whichever is wrong, citing UX.md.
4. **Live run** with the example videos (`GEMINI_LIVE=1 pnpm test:e2e --grep @live`, then by hand): the happy path, `.mov`, the 3:33 and 5:26 videos (long-video notice, D16), a video over 3 minutes, cancel mid-stage, refresh mid-edit, re-pick, highlight, add step, delete + undo, Start new, export, then open the `.docx` in Word. Record timings for DEBRIEF.
5. Fix what breaks. **Cut order if short on time:** highlight editing (fall back to read-only), add-step frame capture, the "Replace current project?" confirm.

## Phase 3: Hardening (≈15 min, parallel)

- **Final review:** one reviewer agent runs `code-review` over the whole of `main` against the docs (each lane was already reviewed in its PR).
- **A11y:** keyboard-only run of the demo script by hand (Playwright's `keyboard.spec.ts` and `a11y.spec.ts` cover the automated part). Record the gaps in UX.md.
- **CI:** push, and confirm the GitHub Actions run is green.
- **Docs:** DECISIONS statuses (Built / Revised), DEBRIEF numbers and "Actual", README final pass.

---

## Shipping each lane (build → PR → review loop → merge)

Adapted from the `/ship` workflow, with **one reviewer per PR** instead of two, and the **main session merges** once the reviewer approves.

```
lane agent: build in worktree ──► gates pass ──► push branch ──► open PR (pr skill)
                                                                      │
main session: spawn 1 reviewer (code-review skill) ◄──────────────────┘
                     │
            findings ─┴─► round: each finding → fix | defer | answer
                     │          lane agent pushes fixes as ONE commit
                     │          reviewer re-reviews ONLY that commit
                     ▼
            reviewer: "approve" on the latest commit, no open findings
                     │
main session: rebase if needed → pnpm check → gh pr merge --squash → next
```

### 1. Build (lane agent)
- Works in its own worktree on branch `lane/<letter>-<name>`, following the ground rules and its lane section.
- **Done when** `pnpm check` passes on the committed work and the lane's testing-strategy rows are implemented.

### 2. Open the PR (lane agent)
- Push the branch and open a PR against `main` with `gh pr create`. Write the body with the `pr` skill: what the lane delivers, the decisions it implements, what's stubbed or cut, how to verify (tests, dev page, curl), and contract change requests.
- **Done when** the PR exists. The lane agent reports the PR URL and **stays available** for fix rounds (the main session messages the same agent, so its context carries over).

### 3. Review loop (main session orchestrates)
- When a PR opens, the main session spawns **one reviewer agent** in the background, told to run the `code-review` skill on that PR. Its lens combines both of `/ship`'s:
  - **Standards and spec:** the ground rules, file ownership, the Phase 0 contracts, and whether every item in the lane section and the decisions it cites is implemented.
  - **Correctness:** behaviour under the diff, edge cases (especially the D10 errors and D13 a11y items the lane touches), and whether the tests actually exercise what they claim.
- The reviewer brief names the PR, the branch, the lane section, and the decisions. It asks for findings as `file:line` plus a failure scenario, ending in an explicit **approve** or **not yet**. Reviewers skip `pnpm build` and E2E; the gates and CI cover those.
- **A round:** every finding gets exactly one disposition:
  - **fix** it;
  - **defer** it to the open **Follow-ups** GitHub issue, as a comment that links the PR which found it;
  - **answer** it, with the reason it stands.
- The lane agent pushes all fixes as **one commit**. The main session then messages the **same reviewer** with that commit, what was fixed, deferred and answered, and asks it to review only that commit.
- **Done when** the reviewer approves the latest commit with no open findings. **If round 3 still disagrees, stop and put the disagreement to the user.**

### 4. Merge (main session)
- Rebase the branch onto `main` if it's behind, then run `pnpm check` on the result.
- Squash-merge with `gh pr merge --squash --delete-branch`. The squash message is the PR title plus the `Co-Authored-By` line.
- After each merge, run `pnpm check` on `main`. If it fails, fix it on `main` immediately before merging the next PR.
- PRs merge **in the order they're approved**. Ownership is disjoint, so order rarely matters. Lane G (E2E) merges last, because its specs only pass once the others are in.
- Tell the user each PR link as it merges, with what the reviewer raised and what changed.

### Spawning the lanes
One message, seven Agent calls, each with `isolation: "worktree"`, run in the background. Brief template:

> You are implementing **Lane X: <name>** of Process Recorder, in your own git worktree.
> 1. Read `docs/IMPLEMENTATION.md`: the ground rules (all of them), the Phase 0 contracts, the HTTP behaviour, your lane section, the testing-strategy rows for your lane, and "Shipping each lane". Then read decisions <D…> in `docs/DECISIONS.md`<, and `docs/UX.md` for UI lanes>.
> 2. Set up your worktree (ground rule 1). Your port is <port>. Create branch `lane/<x>-<name>`.
> 3. Work through your lane's list in order. Edit only the files your lane owns. Mock or fake anything still stubbed.
> 4. <UI lanes:> Match the design on the Claude Design canvas: <canvas link + artboard links>. Read it with your Artifact tool (`action: "read"`); never write to it.
> 5. At about 50 minutes, or when done: make sure `pnpm check` passes, push, open the PR (step 2 of "Shipping each lane"), and reply with the PR URL plus your final report (ground rule 9). Then wait: you may receive review findings to fix. Push each round's fixes as ONE commit and reply with the commit hash and each finding's disposition (fixed / deferred / answered + reason). Never merge your own PR.

**Suggested models:** A, D, E and F (judgement-heavy) on the strongest model. B, C and G on a faster one. Reviewers on the strongest model.

## Risk register

| Risk | Where | Mitigation |
|---|---|---|
| Gemini model rejects video or the schema | A (spike) | `gemini-2.5-flash` fallback via env. The spike runs first |
| shadcn init fails on the Next 16 config | 0 | 5-minute timebox, then Radix primitives |
| Worktrees picked up by tsc/eslint/vitest on main | 0 | `.claude/` excluded everywhere |
| Frame capture flaky across codecs | C | Per-seek timeout → `capture_failed` on that step only |
| Highlight editor overruns | E | 30-minute timebox, read-only fallback |
| Hook is harder than it looks | F | Its own lane with mocks. The fakes let `page.tsx` run before the merge |
| No example videos yet | A, 2 | A QuickTime recording of any web form as a stand-in |
| Clock | all | Lanes report at 50 minutes. The Phase 2 cut order is defined |
