# Code tour

The codebase in the order a request travels through it, with links to the files that matter. About 7,600 lines of source, excluding tests. Decision references (D1–D17) point to [DECISIONS.md](DECISIONS.md).

## 1. The big picture

```
Browser (React client)                                     Server (Next.js route handlers)
───────────────────────────────────────────────            ──────────────────────────────
page.tsx            → renders a screen per job phase
  └ useProcessRecorder  ← the orchestrator (all async work)
       ├ lib/frames.ts       probe + capture video frames (browser only)
       ├ lib/api-client.ts   ── POST /api/upload (NDJSON stream) ──→ app/api/upload/route.ts
       │                     ── POST /api/analyze (JSON) ─────────→ app/api/analyze/route.ts
       │                     ── DELETE /api/file?name= ───────────→ app/api/file/route.ts
       ├ lib/persistence.ts  IndexedDB (autosave, restore)                 └ server/gemini.ts → Gemini API
       ├ lib/export-docx.ts  builds the .docx in the browser                  (or server/gemini-fake.ts)
       └ job-machine + steps-reducer  (state)
```

**The one-sentence version:** the server is a thin, stateless adapter around Gemini that holds the API key. Everything the user produces (steps, screenshots, highlights, the Word file) is made and stored in the browser.

## 2. Server side: `src/app/api/` and `src/server/`

### No middleware, on purpose

There's no `proxy.ts` (Next 16's name for middleware). In Next 16, when a proxy exists, the request body is buffered in memory and **silently truncated at 10 MB**, which would corrupt video uploads without any error (D2). Every check middleware would do (auth, size, type) happens inside the route handlers instead.

### The three routes

**`POST /api/upload`** ([route.ts](../src/app/api/upload/route.ts)): the most interesting server code.

1. `geminiFor(request)` picks the real or fake Gemini backend. With the real backend it throws `missing_api_key` up front if the key is unset.
2. **Checks before reading the body:**
   - the `Content-Type` must be a video;
   - the declared `Content-Length` must be ≤ 500 MB.

   Either failure returns a single NDJSON `error` line with a real HTTP status (415 or 413).
3. It returns a `ReadableStream` response, status 200 and `application/x-ndjson`, and works inside `start()`:
   - sends `{type:"stage", stage:"received"}`;
   - `writeBodyToFile` ([temp-file.ts](../src/server/temp-file.ts)) pipes the request body to a temp file through a `Transform` that **counts bytes while streaming**, so a client that lies about Content-Length still can't exceed 500 MB;
   - rejects a 0-byte body;
   - sends `sending_to_gemini`, then `uploadAndWait` uploads to the Gemini Files API and polls until the file is `ACTIVE`, emitting `gemini_processing`;
   - sends `{type:"ready", fileName}`.
4. **Cancellation:** `request.signal` (the client disconnected) and the stream's `cancel()` (the client stopped reading) both abort one `AbortController`. The `finally` block always deletes the temp file.

**Why stream progress events instead of an upload percentage:** the browser uploads to localhost in about a second, so a progress bar would hit 100% and then sit there. The real time is spent server → Gemini and in Gemini's processing (D4). We measured 8–25 s for those stages on the samples.

**`POST /api/analyze`** ([route.ts](../src/app/api/analyze/route.ts)): `{ fileName }` → JSON.

- **The client sends a file *name*, never a URI.** It's validated against `^files/[a-z0-9-]+$`, and the server resolves it itself, so the client can't make the server fetch arbitrary URIs (D4).
- `generateSteps` → if `isScreenRecording` is false, it returns `not_screen_recording` with the model's reason. Otherwise `normalizeSteps` cleans the result.

**`DELETE /api/file`** ([route.ts](../src/app/api/file/route.ts)): best-effort deletion of the Gemini file when the user picks "Start new". Gemini expires files after 48 h anyway.

**HTTP contract** ([server/http.ts](../src/server/http.ts)): **the client never branches on status codes.** It always parses the body as the contract shape (`UploadEvent` or `AnalyzeResponse`). Statuses (404, 429, 422, 500, 499) exist for correctness and logs. That's what lets an error arrive in the middle of a 200 stream.

### Gemini integration: [server/gemini.ts](../src/server/gemini.ts)

- **`uploadAndWait`:** `files.upload`, then polls `files.get` every 2 s with a 2-minute deadline until `ACTIVE`. On failure it deletes the half-processed file.
- **`generateSteps`:** calls `generateContent` with the video, the [prompt](../src/server/prompt.ts) and a **response schema** (JSON mode, every field required, `box_2d` as an integer array). It runs with low thinking for latency. Then:
  - **`finishReason` checks:**
    - `MAX_TOKENS` → the JSON was truncated;
    - safety-family reasons → `gemini_blocked`;
    - `OTHER` or unknown → `gemini_failed` (retryable).
  - **zod validation** of the parsed JSON.
  - **One retry** if the output was invalid (bad JSON, zod failure, truncation), with the validation error fed back to the model. It's a single nested try, so it can't loop.
- **`classifyGeminiError`** maps everything onto our error kinds: 429 → `rate_limited`, **403 "may not exist" → `file_expired`** (the spike found Gemini returns 403, not 404), 5xx → `gemini_failed`, and so on.
- **`geminiFor(request)`** is the seam: `GEMINI_FAKE=1` swaps in [gemini-fake.ts](../src/server/gemini-fake.ts), which serves canned responses chosen by a `fake-scenario` cookie (`happy`, `rate_limited`, `no_steps`, `slow`…). The end-to-end tests drive every error path through it, at no quota cost. It logs a warning once, so a leftover `GEMINI_FAKE=1` is visible.
- **Known limit:** the SDK's `files.upload` ignores `abortSignal`, so cancelling during "Sending to Gemini" lets that one transfer finish. Polling stops and both files are deleted (documented in D4).

**`normalizeSteps`** ([lib/normalize.ts](../src/lib/normalize.ts)) runs on the server:

- parses `MM:SS` and drops steps whose timestamp doesn't parse;
- sorts by time;
- nudges duplicate timestamps by +0.5 s;
- converts `box_2d` (0–1000) into a normalized rectangle;
- runs `cleanText` on all text, which strips control characters. Real Gemini output contained NULs in place of "ção".

## 3. Client side: the orchestrator hook

### [useProcessRecorder.ts](../src/hooks/useProcessRecorder.ts): where the app logic lives

The most important file to explain. It returns a typed `Recorder` object (defined in [types.ts](../src/lib/types.ts)) holding the state plus actions: `onFile`, `retry`, `cancel`, `startNew`, `repick`, `addStep`, `exportDocx`, `setTitle`. **Components never call APIs or storage directly; everything goes through this hook.**

**`runJob(start)`** is the pipeline:

1. **Normalize the file:** `withVideoType` gives a type-less `.mov` a MIME type from its extension.
2. **Validate:** `validateFile` checks the type and size, then `probeVideo` loads it into a hidden `<video>` to check that it decodes and is ≤ 10:00. That fails in milliseconds, before any upload or quota.
3. **Save the video** to IndexedDB.
4. **Upload:** `uploadVideo`, whose stage callbacks drive the job state and the screen-reader announcements.
5. **Analyze:** `analyzeVideo`, then `stepsFromRaw` (clamps timestamps to the video length and gives each step an id), then the **first persist** of the project.
6. **Capture:** `captureAll` grabs one screenshot per step, sequentially.
7. **Finish:** `succeed`, focus the results heading, announce "N steps ready".

**Three patterns worth naming in an interview:**

- **Generation counter plus one `AbortController`.** Every job increments `genRef`. After every `await`, `check()` throws `cancelled` if the job was aborted or superseded. A cancelled or replaced job can therefore never write state, even if its network call returns late. This prevents stale-response bugs.
- **Retry resumes from the failed stage.** A failure records `retryFrom` (upload, analyze or capture), based on the stage it happened in. An analysis failure re-analyzes the stored `fileName` **without re-uploading**. `file_expired` falls back to re-uploading the stored video blob.
- **Confirm dialogs are promises.** `askConfirm("replace")` returns a promise that `resolveConfirm(ok)` settles, so `onFile` reads as straight-line code: `if (!(await askConfirm(...))) return`.

**Other effects in the hook:**

- **Restore on mount:** `loadAll()` from IndexedDB, rebuild screenshot URLs, dispatch `restore`, announce. Steps that were still pending become "Pick frame". `onFile` waits for the restore to finish, so a file dropped early can't leave the old project under the new video.
- **Autosave:** a debounced saver (500 ms) writes the project JSON, and `pagehide` flushes it.
- **Object URL ownership:** the hook creates and revokes every `blob:` URL. Unmount cleanup is deferred one tick, so React StrictMode's or Fast Refresh's cleanup-then-setup doesn't revoke images still on screen.
- **Export waits for capture:** `exportDocx` awaits any running capture pass, so an early click can't produce "No screenshot" cells (found in the live runs).

### State, as two pure reducers (D7)

- **[job-machine.ts](../src/lib/job-machine.ts):** `idle → running{stage} → ready | error{retryFrom}`, as a discriminated union. Impossible states can't be represented, and **invalid transitions return the same state object**, so they're harmless.
- **[steps-reducer.ts](../src/lib/steps-reducer.ts):** `update`, `add`, `remove`, `undoRemove`, `move`, `setTimestamp`, `setHighlight`… `remove` keeps `lastDeleted` so Undo can restore the step at its original position. Re-picking a frame clears Gemini's suggested highlight, because it belonged to the old frame. A no-op action returns the same state, so autosave doesn't fire for nothing.

## 4. The `lib/` layer: pure logic vs browser I/O

**The rule: anything in `lib/` is framework-free and unit-tested.** React lives only in components and the hook.

| Module | What it does |
|---|---|
| [api-client.ts](../src/lib/api-client.ts) | `fetch` wrappers. Includes a streaming **NDJSON reader** (handles lines split across chunks, multi-byte characters and a final line with no newline), and maps failures to error kinds: abort → `cancelled`, network → `network`, bad JSON → `bad_model_output` |
| [persistence.ts](../src/lib/persistence.ts) | IndexedDB via `idb-keyval`, with **split keys**: `video` written once, `shot:<id>` per screenshot, and only the small `project` JSON debounced, so typing never rewrites megabytes (D8). A **generation counter** discards writes queued before "Start new", so they can't bring the old project back |
| [frames.ts](../src/lib/frames.ts) | **Screenshot capture in the browser (D3):** `probeVideo`, and `createFrameGrabber`, which seeks a hidden `<video>`, waits for `requestVideoFrameCallback` (measured at 16–51 ms), and draws to a canvas. Seeks run one at a time, each with a timeout and abort. `waitForFrameData` **polls** `readyState` because `loadeddata` never fires again after a seek (an integration bug) |
| [image.ts](../src/lib/image.ts) | Encodes WebP (falling back to JPEG if the browser can't), caps width at 1920 px, and burns the highlight into a JPEG at export |
| [export-docx.ts](../src/lib/export-docx.ts) + [export-template.ts](../src/lib/export-template.ts) | Builds the `.docx` in the browser: A4 landscape, a table of the template's visible columns (D11, D17). Templates are pure helpers plus localStorage presets, each validated with zod |
| [errors.ts](../src/lib/errors.ts) | The **error taxonomy** (D10): `AppError(kind, detail)` and `ERROR_COPY` (title, body, hint, primary action and `retryFrom` for every kind). One table drives every error screen |
| [schema.ts](../src/lib/schema.ts), [timestamp.ts](../src/lib/timestamp.ts), [geometry.ts](../src/lib/geometry.ts), [limits.ts](../src/lib/limits.ts), [steps.ts](../src/lib/steps.ts) | Small pure helpers: zod schemas shared by server and client, `MM:SS` parsing, box-to-rectangle conversion, size and length limits plus MIME inference, step creation |
| [types.ts](../src/lib/types.ts), [ui-contracts.ts](../src/lib/ui-contracts.ts) | **The contracts** written before the parallel build: domain types, HTTP shapes, reducer actions, `Recorder`, and every component's props |

## 5. Components: presentation only

- **[page.tsx](../src/app/page.tsx): composition only.** It switches on `job.phase`:
  - `ready`, or running at the capture stage → the editor (StepList, NoSteps, the banners);
  - running → JobProgress;
  - error → ErrorPanel, with its copy from `ERROR_COPY`;
  - idle → EmptyState.

  It also mounts the FramePicker and the ConfirmDialog.
- **`shell/`:**
  - [LiveRegion.tsx](../src/components/shell/LiveRegion.tsx) holds the **single** screen-reader announcement area (`useAnnounce`; D13 allows exactly one), mounted once via [AppShell.tsx](../src/components/shell/AppShell.tsx).
  - [AppHeader](../src/components/shell/AppHeader.tsx) is sticky, with title and actions slots, and measures its own height for `scroll-padding`.
- **`upload/`:** Dropzone (a real button plus a hidden file input), EmptyState, JobProgress (stage list with elapsed time; silent, because the hook does the announcing), CaptureBanner.
- **`editor/`:**
  - [StepList](../src/components/editor/StepList.tsx) (focus management after move, delete and undo; the inline "Step N deleted · Undo" row);
  - [StepCard](../src/components/editor/StepCard.tsx) (labelled auto-growing text fields, `aria-disabled` Move buttons that keep focus);
  - DeletedStepRow.
- **[highlight/HighlightEditor](../src/components/highlight/HighlightEditor.tsx):** an SVG overlay with 4 corner handles. Dragging updates once per animation frame and commits on pointer-up; arrow keys move it and Alt+arrows resize it.
- **[frames/FramePicker](../src/components/frames/FramePicker.tsx):** the scrubber dialog. Only the newest seek counts, Enter confirms only from the slider, and the whole confirm is capped at 6 s with its own `AbortController`.
- **`feedback/`:** ErrorPanel (focuses its `h1` on mount, with no `role="alert"`, to avoid double announcements), ConfirmDialog, Banner.
- **`project/`:** ProjectTitle, ExportButton, [ExportOptions](../src/components/project/ExportOptions.tsx) (the templates dialog).
- **`ui/`:** the shadcn/Radix building blocks.

## 6. How it's tested

- **Unit tests** sit next to each `lib/` module.
- **Component tests** use jsdom and end with an axe check.
- **Route tests** call `POST(new Request(...))` directly.
- **Contract fixtures** in [`src/fixtures/http/`](../src/fixtures/http/) are shared by the server and client tests, so the two sides can't drift apart.
- **End-to-end:** Playwright plus axe against fake Gemini ([`e2e/`](../e2e/)), including keyboard-only and persistence-across-reload specs, using synthetic ffmpeg videos for the edge cases.
- **Live:** one opt-in `@live` spec against real Gemini.
- **CI** runs everything, and the end-to-end job blocks merges. Totals: 524 unit/component tests and 19 end-to-end tests.

Dev pages for checking things by eye: `/dev/states`, `/dev/editor`, `/dev/media`.

## 7. Likely interview questions and short answers

- **"Where's the business logic?"** The pipeline is in `useProcessRecorder`. The rules are in pure `lib/` modules and two reducers. Components only render and call `Recorder` actions.
- **"Why is there no middleware?"** Next 16's proxy buffers request bodies and silently truncates them at 10 MB, so validation happens inside the routes.
- **"How do you handle cancel and race conditions?"** One AbortController plus a generation counter per job, with a check after every await. Storage writes have their own generation, so stale writes are dropped.
- **"Why capture screenshots in the browser?"** No ffmpeg on the server. Re-picking a frame reuses the same code with instant feedback. Each step's screenshots take about 1–2 s.
- **"How do you deal with unreliable LLM output?"** A response schema, zod validation, `finishReason` checks, one retry with the error fed back, normalization and `cleanText`, and a typed error for each failure mode.
- **"What would you change for production?"** Upload straight from the browser to storage plus a job queue (D1), server-side projects, and the quality loop.
