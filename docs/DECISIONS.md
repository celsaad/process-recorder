# Decision log

Each entry records the context, the decision, the alternatives considered, and the tradeoff accepted.
Status: **Planned** = decided, not yet built · **Built** = implemented · **Revised** = changed during the build (see note).

---

## D1. Run locally; no deployment target

**Status:** Planned

**Context.** The exercise is 3 hours. Videos are up to 3 minutes; QuickTime screen recordings on a Retina display can be 50–300 MB.

**Decision.** Run with `pnpm dev` / `pnpm start` on the user's machine. The repo is pushed to GitHub for review, not deployed.

**Alternatives.**
- *Vercel.* Serverless functions cap request bodies at ~4.5 MB, so the video cannot go through our server. We would have to upload directly from the browser to a Gemini resumable-upload URL minted by the server. Doable, but it adds CORS and session-URL handling to the riskiest part of the app.

**Tradeoff / what changes for production.** Production would switch to direct-to-storage upload (Gemini resumable URL or a GCS/S3 signed URL), with the server only minting URLs and calling Gemini by file reference. The client upload module is isolated so only the transport changes.

---

## D2. Next.js App Router + TypeScript + Tailwind + shadcn/ui

**Status:** Planned

**Context.** Recommended in the brief; we want accessible primitives without spending time on them.

**Decision.** Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui (Radix underneath).

**Why shadcn/Radix.** Dialogs trap and restore focus, menus/tooltips are keyboard-operable and correctly labelled, and `Escape` works everywhere. That covers a large share of the a11y work for free, and the components are copied into the repo so we can adjust them.

**Note.** Next 16 has breaking changes vs older versions; we follow the bundled docs in `node_modules/next/dist/docs/`. Route handlers have no request body size limit; the 1 MB `proxyClientMaxBodySize` only applies when a `proxy.ts` exists, so we deliberately do not add one.

---

## D3. Screenshots are captured in the browser, not on the server

**Status:** Planned

**Context.** Gemini returns timestamps, not images. Someone has to turn timestamps into frames.

**Decision.** The browser already holds the video `File`. After analysis we load it into an off-screen `<video>`, seek to each timestamp, wait for `seeked`, and draw the frame to a `<canvas>` → `Blob` (PNG/JPEG).

**Alternatives.**
- *ffmpeg on the server.* Requires a native binary, keeps the video on disk longer, and every "re-pick" would be a server round trip.

**Why.**
- Zero server video processing; nothing to install.
- **Re-picking a screenshot from another moment (feature 2) uses the same seek-and-capture function** behind a scrubber, with instant feedback.
- Screenshots are at the recording's native resolution.

**Tradeoff.** Depends on the browser being able to decode the file. HEVC `.mov` may not decode in Chrome. We detect this (`video.error` / `loadedmetadata` never firing / zero dimensions) *before* uploading and show a specific message (see D10). Captures run sequentially (one seek at a time) because parallel seeks on one element race.

---

## D4. Two-step server API: upload, then analyze

**Status:** Planned

**Decision.**
1. `POST /api/upload`: raw video body. The server streams it to a temp file, uploads it to the **Gemini Files API**, polls until the file is `ACTIVE`, and returns `{ fileUri, mimeType, name }`.
2. `POST /api/analyze` `{ fileUri, mimeType }`: calls `generateContent` with a response schema and **streams NDJSON progress events** back (`analyzing` → `validating` → `done | error`).

**Why split.**
- **Upload progress:** `fetch` has no upload-progress events, so the upload uses `XMLHttpRequest` (`upload.onprogress`). Analysis uses `fetch` + `ReadableStream` for streamed events. Each transport does what it is good at.
- **Retry without re-uploading:** if analysis fails (rate limit, bad JSON), "Try again" re-calls `/api/analyze` with the same `fileUri`. Gemini keeps files for 48 h. The same applies to "Regenerate steps".
- Each endpoint has one job, which makes errors easier to classify.

**Why stream to a temp file.** `request.blob()` would hold up to a few hundred MB in memory per request. Piping `request.body` to `os.tmpdir()` keeps memory flat; the file is deleted in `finally`.

**Cancellation.** The client aborts XHR/fetch via `AbortController`. Server handlers pass `request.signal` to the Gemini SDK calls and polling loop so a cancelled job stops spending quota.

**API key.** Only read on the server from `GEMINI_API_KEY` (`.env.local`, gitignored). Never sent to the client and never committed.

---

## D5. Structured output with a response schema, validated with zod

**Status:** Planned

**Decision.** Call Gemini with `responseMimeType: "application/json"` and a `responseSchema`:

```ts
{
  isScreenRecording: boolean,
  rejectionReason?: string,       // when it isn't a usable recording
  processTitle: string,           // e.g. "Create a purchase order"
  steps: Array<{
    action: string,               // imperative, e.g. "Click 'New Order'"
    description: string,
    expectedResult: string,
    timestamp: string,            // "MM:SS" or "MM:SS.s"; parsed client-side
    highlight?: { box_2d: [ymin, xmin, ymax, xmax] } // 0–1000 normalized
  }>
}
```

The server validates with **zod**. On a schema failure it retries once with the validation error appended to the prompt, then returns a typed `bad_model_output` error.

**Why.** Free-text parsing is the most common failure mode of LLM features. A schema plus a validator turns "the model said something weird" into a known, handleable error.

**Timestamps as strings.** Gemini is documented and tuned to reference video moments as `MM:SS`. We parse them in one pure, unit-tested function (`parseTimestamp`) and clamp to `[0, duration]`.

**Model.** Configurable via `GEMINI_MODEL` (default `gemini-2.5-flash`): it has video understanding, structured output and good latency. Pro is an env change away if quality needs it.

**Frame sampling.** Gemini samples video at 1 fps by default. Screen recordings have fast clicks, so we may raise `videoMetadata.fps` (e.g. 2–3) if 1 fps misses steps. A 3-minute video at 1 fps is ~180 frames, well within limits.

---

## D6. Which frame is "the" screenshot

**Status:** Planned

**Decision.** Ask Gemini for the timestamp **just before the action is performed** (the target is visible and not yet clicked). Capture at that time. The highlight box (D9) marks *where* to act.

**Why.** A test script tells a tester what to click; the "Expected result" column describes the outcome in text. If users prefer the after-state for a step, they re-pick it (feature 2).

**Mitigation for drift.** Model timestamps can be off by ~1 s. The re-pick scrubber opens centred on the current timestamp with ±0.1 s / ±1 s stepping, so fixing it takes seconds.

---

## D7. Client state is an explicit state machine

**Status:** Planned

**Decision.** A single `useReducer` with a discriminated union for the job phase:

```
idle → validating → uploading{progress} → processing → analyzing → capturing{done,total} → ready
          ↓              ↓                      ↓            ↓              ↓
                                   error{kind, retryable, retryFrom}
```

Steps live in a separate reducer (`add | update | remove | restore | move | setScreenshot | setHighlight`).

**Why.** Impossible states (e.g. "uploading and showing results") can't be represented. Every phase maps to exactly one UI and one live-region message. `retryFrom` says where retry resumes (re-upload vs re-analyze vs re-capture). Reducers are pure and unit-tested.

---

## D8. Local persistence in IndexedDB with debounced autosave

**Status:** Planned

**Decision.** Persist the current project (video `Blob`, steps, screenshot `Blob`s, highlight rects, Gemini `fileUri`) to IndexedDB via `idb-keyval`. Step edits save **500 ms after the last keystroke** (debounced), plus an immediate flush on `visibilitychange`/`pagehide`. A small "Saving… / Saved" indicator in the header.

**Why.** "The output is never right the first time": users will spend 10+ minutes editing. Losing that on a refresh would be the worst bug in the product. IndexedDB (not localStorage) because we store binary blobs of many MB.

**Scope.** One project at a time with "Start new". A project list is a natural next step but not needed for the core flow.

**Tradeoff.** Data lives in one browser on one machine. No accounts/sync, which fits running locally.

---

## D9. Highlights are data, not pixels; Gemini suggests them

**Status:** Planned

**Decision.** Each step can have one or more highlight rectangles stored as **normalized coordinates (0–1)**. Gemini is asked for a `box_2d` around the UI element acted on; we convert it and show it as a *suggested* highlight the user can move, resize, delete or redraw. Highlights are drawn as an SVG overlay in the UI and **composited into the image only at export**.

**Why.**
- Normalized coordinates work at any display size and survive re-picking a frame.
- Keeping the original screenshot means a highlight can always be edited or removed.
- A model-suggested box is the "creative" step: most of the time the user only nudges it.

**Accessibility.** Rectangles can be moved and resized with the arrow keys (Shift = larger steps). The overlay has an accessible name ("Highlight 1 on step 3 screenshot") and Delete removes it.

**Risk.** Bounding boxes from video frames can be imprecise. That's why they're suggestions and are trivially editable.

---

## D10. Error taxonomy: every error has a cause, a message and a next action

**Status:** Planned

| Kind | Detected where | User sees | Action |
|---|---|---|---|
| `unsupported_type` | client, before upload | "That's a .pdf. Upload an MP4, MOV or WebM screen recording." | Choose another file |
| `too_long` | client (`loadedmetadata`) | "This video is 4:12. Recordings must be 3 minutes or less." | Choose another file |
| `too_large` | client | Size limit with actual size | Choose another file |
| `undecodable` | client (hidden `<video>` fails) | "Your browser can't play this video (often HEVC). Re-export as H.264 or try Safari." | Choose another file |
| `network` | client | "Connection lost during upload." | Retry (re-upload) |
| `rate_limited` (429) | server | "Gemini is busy. Retrying in Ns…" (auto-retry with backoff, then manual) | Retry |
| `gemini_failed` (5xx / file `FAILED`) | server | "Gemini couldn't process the video." | Retry / choose another |
| `bad_model_output` | server (zod) | "We couldn't read the AI's response." | Retry analysis (no re-upload) |
| `not_screen_recording` | model flag | Model's `rejectionReason` + example of a good recording | Choose another file |
| `no_steps` | model returned `[]` | Empty state with "Add steps manually" (the video stays available for capture) | Add manually / regenerate |
| `capture_failed` | client | Placeholder on that step only + "Pick frame" | Re-pick |
| `cancelled` | user | Back to the dropzone, no error styling | None |

Validation that can run in the browser runs there first, so obviously bad files fail in milliseconds without spending upload time or quota. An error boundary (`error.tsx`) catches anything unexpected and offers "Reload" without losing persisted data.

---

## D11. Export: Word first, Markdown second, print/PDF third

**Status:** Planned

**Decision.** Build `.docx` **client-side** with the `docx` library: a title, then a table with columns *# · Action · Description · Expected result · Screenshot*. Screenshots have highlights composited in and are scaled to fit the page width. Markdown export (images as a zip or inline data) and a print stylesheet cover the other paths.

**Why client-side.** All the data (including image blobs) is already in the browser. No server round trip and nothing to clean up.

**Why Word first.** The brief: output "has to end up in a client's template", and consultants live in Word. Tables are easy to paste into an existing template.

---

## D12. Step editing UX

**Status:** Planned

- Inline-editable fields (auto-growing textareas). No modal "edit mode".
- Reorder with **dnd-kit**, which supports a keyboard sensor and screen-reader announcements. Also explicit "Move up/down" buttons (⌘↑ / ⌘↓ when focus is in a step).
- Delete shows an **undo toast** (5 s) instead of a confirmation dialog: faster, and mistakes are recoverable.
- "Add step" inserts after the focused step and captures a frame at that step's timestamp + 1 s as a starting point.
- Each step shows its timestamp as a button that jumps the preview video there.

---

## D13. Accessibility baseline

**Status:** Planned

Target: **WCAG 2.2 AA**, checked with keyboard-only walkthroughs and axe DevTools.

- Landmarks (`header`, `main`) and a logical heading order.
- The dropzone is a real `<button>` + hidden `<input type="file">`; drag-and-drop is an enhancement, not the only path.
- One `aria-live="polite"` region announces phase changes ("Uploading 45%" is throttled to 10% increments so screen readers aren't flooded); errors use `role="alert"`.
- Focus management: on success focus moves to the results heading; on error, to the error message; dialogs return focus to their trigger.
- Every input has a visible label (or `aria-label` where the column header is the visual label).
- Screenshot `alt` = the step's action text.
- Visible focus rings; `prefers-reduced-motion` disables non-essential animation; AA contrast in the palette.

---

## D14. Testing scope

**Status:** Planned

Given 3 hours: **Vitest unit tests on pure logic** (`parseTimestamp`, the zod schema / Gemini response normalisation, box conversion, the reducers, and the docx table builder's data mapping). The UI is verified manually against the example videos and with an axe pass. Playwright end-to-end tests with a mocked Gemini are the next investment.

---

## D15. Scope cuts (deliberate)

- **Custom columns per client:** valuable, but it changes the data model, editor and export at once. Cut in favour of depth on features 1–4. The export builder takes a column list internally so this is an extension, not a rewrite.
- **Accounts, multiple projects, sharing:** not needed to prove the workflow.
- **Server-side job queue:** with one local user, a streaming request is enough. Production would use a job queue + polling/SSE so a closed tab doesn't kill a job.
