# Decision log

Each entry records the context, the decision, the alternatives considered, and the tradeoff accepted.
Status: **Planned** = decided, not yet built · **Built** = implemented · **Revised** = changed during the build (see note).

The plan was reviewed by an independent AI reviewer before any code was written. The [review log](#review-log) at the end lists what changed and why.

---

## D1. Run locally; no deployment target

**Status:** Planned

**Context.** The exercise is 3 hours. Videos are expected to be under 3 minutes (see D16); QuickTime screen recordings on a Retina display can be 50–300 MB.

**Decision.** Run with `pnpm dev` / `pnpm start` on the user's machine. The repo is on GitHub for review, not deployed.

**Alternatives.**
- *Vercel.* Serverless functions cap request bodies at ~4.5 MB, so the video cannot go through our server. We would have to upload directly from the browser to a Gemini resumable-upload URL minted by the server. Doable, but it adds CORS and session-URL handling to the riskiest part of the app.

**Tradeoff / what changes for production.** Production would switch to direct-to-storage upload (Gemini resumable URL or a GCS/S3 signed URL) and a job queue. The server would only mint URLs and call Gemini by file reference. The client transport module is isolated so only it changes.

---

## D2. Next.js App Router + TypeScript + Tailwind + shadcn/ui

**Status:** Planned

**Decision.** Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui (Radix underneath).

**Why shadcn/Radix.** Dialogs trap and restore focus, menus/tooltips are keyboard-operable and correctly labelled, and `Escape` works everywhere. That covers a large share of the a11y work for free, and the components are copied into the repo so we can adjust them.

**Notes.**
- Next 16 has breaking changes vs older versions. We follow the bundled docs in `node_modules/next/dist/docs/`.
- Route handlers have no documented request body limit. `proxyClientMaxBodySize` (default **10 MB**; bodies over it are *silently truncated*, not rejected) applies only when a `proxy.ts` exists. **We must never add a `proxy.ts`**, or uploads would be cut off without an error.
- The scaffold enables `cacheComponents` and a custom Tailwind Turbopack loader. If `shadcn init` fights that setup, fall back to plain Radix primitives.

---

## D3. Screenshots are captured in the browser, not on the server

**Status:** Planned

**Context.** Gemini returns timestamps, not images. Someone has to turn timestamps into frames.

**Decision.** The browser already holds the video `File`. After analysis we load it into an off-screen `<video>` (object URL, so the canvas is not tainted), seek to each timestamp, and draw the frame to a `<canvas>` → **WebP (max 1920 px wide)**, falling back to JPEG.

**Alternatives.**
- *ffmpeg on the server.* Requires a native binary, keeps the video on disk longer, and every "re-pick" would be a server round trip.

**Why.**
- Zero server video processing; nothing to install.
- **Re-picking a screenshot from another moment (feature 2) reuses the same seek-and-capture function** behind a scrubber, with instant feedback.

**Image format: WebP for storage, JPEG for export.**

| Format | Verdict | Reason |
|---|---|---|
| PNG | No | Native Retina PNGs are 2–5 MB each. Twenty would make a 50 MB+ `.docx` and bloat IndexedDB |
| JPEG | Fallback + export | Universal, but smears text edges and thin UI lines, which is its worst case |
| **WebP** | **Stored format** | About 25–35% smaller than JPEG at similar quality, and noticeably cleaner text. `canvas.toBlob("image/webp")` works in Chrome and Firefox |
| AVIF | No | Browsers decode it but none encode it from a canvas. Would need a WASM encoder: bundle weight and seconds per frame for a small gain over WebP |

- **Capture:** `toBlob("image/webp", 0.9)`, then **check `blob.type`**. Browsers that can't encode WebP silently return PNG (possibly Safari; unconfirmed). In that case we re-encode as JPEG 0.9.
- **Export:** the `docx` library only embeds PNG/JPEG/GIF/BMP/SVG, and client templates get opened in Word versions, Google Docs and LibreOffice that may not handle WebP. Export already redraws each screenshot on a canvas to burn in the highlight (D9, D11), so it outputs **JPEG 0.92** at no extra cost.
- **To test in the spike:** lossless WebP. UI screenshots are mostly flat colour, so lossless may come out close in size to lossy with perfect text. Compare both on a frame from the example videos and keep the smaller one that reads cleanly.

**Seek details (where browser capture usually breaks).**
- Captures run **sequentially** on one element. Parallel seeks race.
- Setting `currentTime` to its current value **never fires `seeked`** (e.g. step 1 at 0:00 right after load). We guard against that and wrap every seek in a timeout that resolves to `capture_failed` for that step only.
- We draw after `requestVideoFrameCallback` where available (falling back to `seeked`), so the painted frame matches the seek.
- `loadedmetadata` gets an explicit timeout. If it never fires, the file is `undecodable`.
- MediaRecorder WebM files can report `duration === Infinity`. We work around it with the "seek to a huge time, then read duration" trick before the 3-minute check.

**Decodability.** `canPlayType("video/quicktime")` returns `""` in Chrome even though Chrome plays H.264 `.mov`. So we **probe by loading the file**, not by MIME type. Modern Chrome on most Macs decodes HEVC too. When decoding does fail, the copy suggests re-exporting as H.264 rather than blaming the browser.

---

## D4. Two-step server API: upload, then analyze

**Status:** Planned

**Decision.**
1. `POST /api/upload`: raw video body (`fetch`). The server checks `Content-Length` and the type, pipes `request.body` to a temp file, uploads it to the **Gemini Files API**, and polls until the file is `ACTIVE`. **The response is an NDJSON stream of stage events:** `received` → `sending_to_gemini` → `gemini_processing` → `ready { fileName, mimeType }` (or `error`).
2. `POST /api/analyze` `{ fileName }`: the server resolves the file with `files.get` and calls `generateContent` with a response schema. It returns plain JSON: `{ processTitle, steps }` or a typed error. Nothing streams here because a non-streamed `generateContent` has nothing to report until it finishes.

**Why honest stages instead of an upload percentage.** The browser uploads to *localhost*, which finishes in about a second. The real wait (server → Gemini, then Gemini's `PROCESSING` state) happens after that. An XHR progress bar would jump to 100% and then sit there, which is theatre. Streaming stage events from the server shows where time actually goes. Each stage shows elapsed time, with an indeterminate bar.

**Why split into two endpoints.**
- **Retry without re-uploading:** if analysis fails (rate limit, bad output), "Try again" calls `/api/analyze` with the same `fileName`. Gemini keeps files for 48 h.
- Each endpoint has one job, which makes errors easier to classify.

**Why the client sends `fileName`, not a URI.** The server resolves the file itself. The client can only refer to files by name, not supply an arbitrary URI for the server to fetch.

**Why stream to a temp file.** `request.blob()` would hold up to a few hundred MB in memory per request. Piping to `os.tmpdir()` keeps memory flat. The file is deleted in `finally`. *To verify in the spike:* piping `request.body` to disk in a Next 16 route handler, and `request.signal` firing when the client disconnects.

**Server-side limits.** The client checks everything first, but client checks can be bypassed. The server rejects bodies over **500 MB** (the Files API allows 2 GB) or with a non-video `Content-Type`. The `PROCESSING` poll times out after 2 minutes.

**Cancellation.** The client aborts with `AbortController`. Server handlers pass `request.signal` to the polling loop and SDK calls. This stops *our waiting*. A `generateContent` call already in flight may still be billed.

**Secrets.** `GEMINI_API_KEY` is read only on the server from `.env.local` (gitignored, verified). If it is missing, both endpoints return `missing_api_key` and the UI shows setup instructions instead of a generic failure.

---

## D5. Structured output with a response schema, validated with zod

**Status:** Planned

**Decision.** Call Gemini with `responseMimeType: "application/json"` and a `responseSchema` (OpenAPI subset). Every field is listed in `required`, and `propertyOrdering` is set:

```ts
{
  isScreenRecording: boolean,
  rejectionReason: string,        // "" when usable
  processTitle: string,           // e.g. "Create a purchase order"
  steps: Array<{
    action: string,               // imperative, e.g. "Click 'New Order'"
    description: string,
    expectedResult: string,
    timestamp: string,            // "MM:SS", the moment just before the action
    box_2d: number[]              // ARRAY of INTEGER: [ymin, xmin, ymax, xmax], 0–1000, or [] if none
  }>
}
```

The OpenAPI subset has no tuples, so `box_2d` is a plain integer array. zod accepts length 0 or 4 within 0–1000. Any other shape becomes `[]` (no highlight) instead of failing the whole response, because a bad box shouldn't cost the user their steps.

**Validation and retries.**
- The server validates with **zod**. On failure it retries once with the validation error added to the prompt. If that fails too, it returns `bad_model_output`.
- It checks `finishReason`: `MAX_TOKENS` means truncated JSON (→ `bad_model_output`), and `SAFETY` / an empty response → `gemini_blocked`.
- Steps are **sorted by timestamp, and duplicates are nudged** (+0.5 s) so they can't collide.

**Timestamps.** `MM:SS` only. Gemini samples video at 1 fps by default, so `MM:SS.s` would be false precision. `parseTimestamp` is a pure, unit-tested function that clamps to `[0, duration]`.

**Model.** Configurable via `GEMINI_MODEL`, default **`gemini-3.8-flash`**. It is the newest non-preview Flash available to the provided key (checked with `models.list` on 2026-11-20). The first spike confirms that it handles video and structured output and accepts `video/quicktime`. `gemini-2.5-flash` is the known-good fallback. We set a **low thinking level** for latency, because this task is extraction rather than reasoning.

**Not tuning sampling.** We keep the default 1 fps. Higher fps multiplies tokens and can hit free-tier tokens-per-minute limits. If steps are missed, re-picking and adding steps cover the gap.

---

## D6. Which frame is "the" screenshot

**Status:** Planned

**Decision.** Ask Gemini for the timestamp **just before the action is performed** (the target is visible and not yet clicked). Capture at that time. The highlight box (D9) marks *where* to act.

**Why.** A test script tells a tester what to click; the "Expected result" column describes the outcome in text. If users prefer the after-state for a step, they re-pick it (feature 2).

**Mitigation for drift.** Model timestamps can be off by about 1 s. The re-pick scrubber opens on the current timestamp with ±0.1 s / ±1 s stepping, so fixing it takes seconds.

---

## D7. Client state is an explicit state machine

**Status:** Planned

**Decision.** A single `useReducer` with a discriminated union for the job phase. The stages mirror the server's events (D4):

```
idle → validating → uploading{stage, startedAt} → analyzing → capturing{done,total} → ready
          ↓                    ↓                      ↓              ↓
                      error{kind, retryFrom: "upload" | "analyze" | "capture"}
```

Steps live in a separate reducer (`add | update | remove | restore | move | setScreenshot | setHighlight`).

**Why.** Impossible states (e.g. "uploading and showing results") can't be represented. Every phase maps to exactly one UI and one status message. `retryFrom` says where retry resumes, e.g. re-analyze without re-uploading. Both reducers are pure and unit-tested.

---

## D8. Local persistence in IndexedDB with debounced autosave

**Status:** Planned

**Decision.** Persist the current project to IndexedDB (`idb-keyval`) **under separate keys, so a text edit never rewrites binary data**:

| Key | Content | Written when |
|---|---|---|
| `video` | Original video `Blob` | Once, after validation |
| `shot:<stepId>` | Screenshot `Blob` (WebP, JPEG fallback) | On capture / re-pick |
| `project` | JSON: title, steps (text, timestamp, highlight), Gemini `fileName` + `uploadedAt` | **Debounced 500 ms** after the last edit, plus a best-effort flush on `pagehide` |

A "Saving… / Saved" indicator sits in the header.

**Why.** "The output is never right the first time": users will spend 10+ minutes editing, and losing that on a refresh would be the worst bug in the product. IndexedDB (not localStorage) because we store binary blobs of many MB.

**Honest limits.**
- The `pagehide` flush is best-effort, because browsers don't guarantee async IndexedDB writes during unload. At worst, the last ~500 ms of typing is lost.
- A `QuotaExceededError` surfaces as `storage_full`. The editor keeps working in memory and warns that changes won't survive a refresh.
- Data lives in one browser on one machine. No accounts or sync.

**Scope.** One project at a time. **"Start new" clears IndexedDB and deletes the Gemini file** (`files.delete`) after confirming.

---

## D9. One highlight per step: Gemini suggests it, the user adjusts it

**Status:** Planned, **timeboxed to 30 minutes** (the first feature cut if it overruns)

**Decision.** Each step has **at most one** highlight rectangle, stored as **normalized coordinates (0–1)**.
- Gemini's `box_2d` (0–1000) is converted into a *suggested* rectangle.
- The user can move or resize it with the pointer, nudge it with the arrow keys, delete it, or add one if none was suggested.
- It is drawn as an SVG overlay and **composited into the image only at export**.

**Why.**
- Normalized coordinates work at any display size.
- Keeping the original screenshot means a highlight can always be edited or removed.
- A model-suggested box is the "creative" step: most of the time the user only nudges it.

**Known risk.** The box refers to the frame Gemini sampled, which may differ slightly from the frame we capture at the parsed timestamp. Box accuracy on video frames is also not documented. That is why the box is a suggestion, and why it is *hidden* after the user re-picks a different moment. Fallback if accuracy is poor: send the captured frame back to Gemini as an image and ask for the box on that exact frame.

**Accessibility.** The rectangle is a focusable element named "Highlight on step 3 screenshot". Arrows move it, `Shift` + arrows move it 10×, `Alt` + arrows resize it, and Delete removes it. Explicit buttons ("Remove highlight", "Add highlight") give a non-drag alternative.

---

## D10. Error taxonomy: every error has a cause, a message and a next action

**Status:** Planned

| Kind | Detected where | User sees | Action |
|---|---|---|---|
| `missing_api_key` | server | "GEMINI_API_KEY isn't set. Add it to .env.local and restart." | None (setup) |
| `unsupported_type` | client + server | "That's a .pdf. Upload an MP4, MOV or WebM screen recording." | Choose another file |
| `too_long` | client | "This video is 12:40. Recordings must be 10 minutes or less." (see D16) | Choose another file |
| `too_large` | client + server | "This file is 640 MB. The limit is 500 MB." | Choose another file |
| `undecodable` | client (load probe + timeout) | "This video can't be played here. Re-export it as H.264 MP4." | Choose another file |
| `network` | client | "Connection lost." | Retry from the failed stage |
| `rate_limited` (429) | server | "Gemini is rate-limiting requests. Wait a moment and try again." | Retry (no re-upload) |
| `gemini_failed` (5xx / file `FAILED` / poll timeout) | server | "Gemini couldn't process the video." | Retry / choose another file |
| `gemini_blocked` (`SAFETY` / empty) | server | "Gemini declined to analyze this video." | Choose another file |
| `bad_model_output` (zod / `MAX_TOKENS`) | server | "The AI's response came back incomplete." | Retry analysis (no re-upload) |
| `file_expired` | server (`files.get` 404, e.g. retrying analysis on a project restored after 48 h) | "The uploaded video expired. We'll upload it again from your browser." | Retry (re-uploads from the stored video blob) |
| `not_screen_recording` | model flag | The model's `rejectionReason` + what a good recording looks like | Choose another file |
| `no_steps` | model returned `[]` | Empty state with "Add a step manually" | Add manually |
| `capture_failed` | client (seek timeout) | Placeholder on that step only + "Pick frame" | Re-pick |
| `storage_full` | client (`QuotaExceededError`) | Banner: "Changes won't survive a refresh. Export now." | Export |
| `cancelled` | user | Back to the dropzone, no error styling | None |

Validation that can run in the browser runs there first, so obviously bad files fail in milliseconds without spending upload time or quota. An error boundary (`error.tsx`) catches anything unexpected and offers "Reload", and persisted data survives the reload.

---

## D11. Export: Word only

**Status:** Planned

**Decision.** Build `.docx` **client-side** with the `docx` library:
- A **landscape** page with the title, then a table with columns *# · Action · Description · Expected result · Screenshot*.
- Screenshots have the highlight composited in, are passed to `ImageRun` as bytes with explicit dimensions, and are scaled to the column width.

**Why client-side.** All the data (including image blobs) is already in the browser. No server round trip and nothing to clean up.

**Why only Word.** The brief: output "has to end up in a client's template", and consultants live in Word. Markdown and print/PDF were cut for time (D15).

---

## D12. Step editing UX

**Status:** Planned

- Inline-editable fields (auto-growing textareas). No modal "edit mode".
- Reordering uses **Move up / Move down buttons** on each step. Focus follows the moved step, and a status message announces "Step 3 moved to position 2". This meets WCAG 2.5.7 without drag. Drag-and-drop (dnd-kit) is a stretch goal.
- **No custom keyboard shortcuts inside steps.** In a macOS textarea, ⌘↑/↓, ⌘⌫ and ⌘Z already mean caret-to-start/end, delete-to-line-start and native undo. Overriding them would break text editing. Tab order plus labelled buttons are the keyboard flow.
- Delete shows a toast with an **Undo button that stays until dismissed or until the next delete** (WCAG 2.2.1 forbids a short timer). Focus moves to the next step, or to the previous one if the last step was deleted.
- "Add step" inserts after the current step at its timestamp + 1 s and captures that frame as a starting point.
- Each step shows its timestamp as a button that opens the frame picker at that moment.

---

## D13. Accessibility baseline

**Status:** Planned

Target: WCAG 2.2 AA where it applies. We check it with **a keyboard-only walkthrough and an axe pass, and list known gaps in this doc** rather than claiming full conformance after a 3-hour build.

- Landmarks (`header`, `main`) and a logical heading order.
- The dropzone is a real `<button>` + hidden `<input type="file">`. Drag-and-drop is an enhancement, not the only path.
- One `aria-live="polite"` region announces stage changes.
- Errors: focus moves to the error panel's heading. The panel is *not* also `role="alert"`, which would announce it twice.
- On success, focus moves to the results heading **only after screenshots finish capturing**. While they capture, a status message reports progress and focus stays put.
- Dialogs return focus to their trigger.
- Every input has a visible label.
- Screenshot `alt` = "Screenshot for step 3". The action text sits right next to it, so repeating it in the alt would be redundant.
- Visible focus rings; `prefers-reduced-motion` respected; AA contrast in the palette.

---

## D14. Testing strategy

**Status:** Planned (details: [IMPLEMENTATION.md § Testing strategy](IMPLEMENTATION.md#testing-strategy))

Five layers, each catching a different class of bug:

1. **Unit (Vitest):** every pure module, with a required-cases list per module (timestamps, geometry, schema, normalization, reducers, error mapping, persistence, the API client's NDJSON reader).
2. **Component (Testing Library + `vitest-axe`):** labels, focus management, keyboard handling and per-component axe checks for every interactive component.
3. **Route / contract:** route handlers called directly with Gemini mocked. Server and client both test against the same hand-written wire fixtures, so they can't drift apart.
4. **End-to-end (Playwright + axe):** a real browser and a real sample video, with a **fake Gemini mode** (`GEMINI_FAKE=1`, scenario picked by cookie) so the tests are repeatable, free and fast. Covers the happy path, errors, persistence across reloads, a keyboard-only flow and page-level axe scans. Runs in GitHub Actions.
5. **Live + manual:** one opt-in `@live` spec against real Gemini, plus opening the export in Word.

**Why a fake Gemini mode.** Model output varies and costs quota. Error scenarios (429, blocked, no steps) are hard to trigger on demand. The fake lets the E2E tests check *our* behaviour for each case. The live spec checks the model separately.

**Deliberately not tested:** video decoding in jsdom (impossible; Playwright covers it), model quality by assertion (measured in DEBRIEF instead), visual regression.

---

## D16. Video length: warn over 3 minutes, reject over 10

**Status:** Planned

**Context.** The brief says to expect videos under 3 minutes, but two of the provided example videos are 3:33 and 5:26. A hard 3-minute limit would reject the interviewer's own samples. Real consultants' recordings will also overrun.

**Decision.** All limits live in one constants file (`lib/limits.ts`): `SOFT_DURATION_SEC = 180`, `MAX_DURATION_SEC = 600`, `MAX_BYTES = 500 MB`.
- **≤ 3:00:** no notice.
- **3:00–10:00:** accepted, with a non-blocking info notice during processing and in the editor: "This recording is 5:26. Longer recordings take longer to process and are more likely to miss steps. Check the list carefully."
- **> 10:00:** rejected as `too_long`.

**Why 10 minutes.** At Gemini's default 1 fps, 10 minutes is about 600 frames, which is comfortably within the model's context and keeps processing time reasonable. Beyond that, a "test script" is probably several processes and should be split.

**Tradeoff.** Longer videos mean slower analysis and more step-level mistakes. The notice sets that expectation instead of refusing the work.

---

## D15. Scope cuts (deliberate)

The reviewer estimated the original plan at 6–8 hours. These cuts are ordered from most risk for least value:

1. **Markdown and print/PDF export.** Word is what consultants need.
2. **Streaming on `/api/analyze`.** There was nothing to stream.
3. **dnd-kit drag reordering.** Move buttons are accessible and enough. Stretch goal.
4. **Automatic rate-limit backoff with a countdown.** Manual retry instead, which needs no re-upload.
5. **Multiple and free-drawn highlights.** One per step.
6. **Custom columns per client.** They change the data model, editor and export at once. The docx builder takes a column list internally, so this is an extension, not a rewrite.
7. **Sampling-rate (fps) tuning and a "Regenerate" button.**
8. **Accounts, multiple projects, sharing, a server-side job queue.**

**Build order and timebox:** API spike (20 min) → upload/analyze/capture (50) → editing + persistence (35) → re-pick (20) → docx (25) → highlights (20) → a11y and error pass (10).

---

## Review log

An independent AI reviewer (a separate model with no stake in the plan) critiqued the first draft. Changes made as a result:

| Area | Before | After | Why |
|---|---|---|---|
| D4 progress | XHR upload percentage | Server-streamed stages + elapsed time | Localhost upload takes about a second, so the real wait was invisible |
| D8 storage | One `Project` record including blobs | Separate keys; only the JSON is debounced | A debounced save was rewriting hundreds of MB |
| D5 schema | Tuple `box_2d`, `MM:SS.s`, optional fields | Int array (length 4), `MM:SS`, all required, `finishReason` checks | Tuples aren't expressible. Sub-second precision is false at 1 fps |
| D12 keys | ⌘↑/⌘↓/⌘⌫/⌘Z shortcuts | Buttons only | They collide with native textarea editing on macOS |
| D9 highlights | One or more, free drawing | One per step, timeboxed | Riskiest feature; the docs were inconsistent |
| D5 model | `gemini-2.5-flash` assumed | `gemini-3.8-flash`, checked with `models.list` | Verify instead of assume |
| D2 | "1 MB proxy limit" | 10 MB, silently truncated | It was wrong. The bundled docs say 10 MB |
| D4 security | Client sent `fileUri` | Client sends `fileName`; the server resolves it; server-side size/type checks | Don't let the client choose the URI; client checks can be bypassed |
| D10 | 12 kinds | Added `missing_api_key`, `file_expired`, `gemini_blocked`, `storage_full`, poll timeout | Gaps an interviewer would probe |
| D13 | `role="alert"` + focus move; 5 s undo toast | Focus move only; undo stays until dismissed | Double announcement; WCAG 2.2.1 |
| D3 | Native PNG | WebP stored (JPEG fallback), JPEG on export, max 1920 px | 2–5 MB per PNG would bloat the docx and storage. WebP keeps text sharper than JPEG. AVIF can't be encoded from a canvas. docx needs JPEG/PNG |
| D15 | Markdown, print, dnd-kit, auto-backoff | Cut | Fit 3 hours |
| D16 | Hard reject over 3:00 | Notice over 3:00, reject over 10:00 | Two of the provided example videos are 3:33 and 5:26 |
| D14 | Unit tests on pure logic only | Five layers incl. component, contract, Playwright E2E with fake Gemini, CI | Requested. The contract fixtures also guard the parallel build |
| D5 | `box_2d` both "length 4" and "`[]` if none" | Length 0 or 4; anything else → `[]` | Contradiction found in the plan review |
| D10 | Silent re-upload on `file_expired` | Explicit retry from upload | Second review: the silent path was nearly unreachable |
