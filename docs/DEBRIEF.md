# Debrief guide

A 30-minute walkthrough. Fill in the "Actual" section and the measured numbers as the build progresses.

## 1. Framing (2 min)

- The user is a consultant documenting a process for a client. Their real cost isn't recording; it's **fixing and formatting**. So the AI produces a *draft*, and most of the product effort goes into making the draft fast to correct and easy to get into Word.
- Priorities: core loop → editing → re-pick → Word export → AI-suggested highlights.
- **Process:** I wrote the decisions down *before* coding and had an independent AI reviewer critique them. It caught real issues: a fake progress bar, an autosave that rewrote hundreds of MB, keyboard shortcuts that broke text editing, and a schema Gemini can't express. See the [review log](DECISIONS.md#review-log).

## 2. Demo script (8 min)

1. Empty state → drop a bad file (a PDF, or a video over 10 minutes) → instant, specific error. *Validation runs before any upload time or quota is spent.*
2. Drop a real recording → honest stage list with elapsed time → **cancel** → drop again.
3. Results: screenshots fill in → edit a step → move it **with the keyboard** → delete → Undo.
4. Re-pick a frame with the scrubber (arrow keys).
5. Adjust the Gemini-suggested highlight.
6. **Refresh the page**: everything is still there.
7. Export to Word → open the file.

## 3. Technical choices worth explaining (10 min)

| Topic | One-liner | Ref |
|---|---|---|
| Screenshots in the browser | No ffmpeg. Re-pick reuses the same code. Handled the seek edge cases (same-time seek, timeouts, Infinity duration) | D3 |
| Honest progress | Localhost upload is instant, so I stream real server stages instead of a fake % | D4 |
| Upload/analyze split | Retry analysis without re-uploading. The client passes a file name, never a URI | D4 |
| Schema + zod + 1 retry + finishReason | Turns LLM weirdness into a typed, handleable error | D5 |
| Which frame | Just before the action, plus a highlight on where to act | D6 |
| State machine | Impossible states can't be represented. Each phase has one UI and one announcement | D7 |
| IndexedDB with split keys | Typing saves only small JSON. Blobs are written once | D8 |
| Highlights as data | Editable forever. Composited only on export | D9 |
| Length limits | The brief said under 3 minutes but the example videos weren't, so I warn at 3 and reject at 10 | D16 |
| Error taxonomy | Every error has a cause, a message and a next action. 16 kinds | D10 |
| No shortcuts in textareas | Buttons + Tab order beat clever shortcuts that break editing | D12 |

## 4. What I cut and why (3 min)

From [D15](DECISIONS.md#d15-scope-cuts-deliberate): Markdown/print export, drag reordering, automatic rate-limit backoff, multiple highlights, **custom columns**, fps tuning, accounts. Each was cut for risk vs value inside 3 hours, and each has a clear extension point.

## 5. What I'd do next (4 min)

- **Production upload path:** direct-to-storage upload, a job queue + SSE so a closed tab doesn't kill a job (D1).
- **Custom columns / client templates:** column config feeding the editor and docx builder. Then: upload a client's .docx template and map fields into it.
- **Quality loop:** let users flag wrong steps and use them as eval cases. Compare models on the example set (timestamp drift, missed steps, box accuracy).
- **Playwright e2e tests** with a recorded Gemini response fixture.
- **Collaboration:** projects stored server-side, share links, reviewer comments.

## 6. Risks and what I'd check with users (3 min)

- **Client data privacy.** Recordings of client systems go to a third-party API. Google's terms on the free tier allow content to be used to improve products. A real rollout needs a paid tier / Vertex AI with a data-processing agreement, plus blurring or redacting sensitive fields before export. We already delete the Gemini file on "Start new".
- **Timestamp drift (about ±1 s).** The re-pick flow mitigates it. Measure how often users re-pick.
- **Long or noisy recordings** (idle time, mistakes). The prompt asks Gemini to skip non-actions, and users can delete steps.

## Measured numbers (fill in from the example videos)

| Metric | Value |
|---|---|
| Upload + Gemini processing time (2-minute video) | |
| Analysis time | |
| Steps found vs actual | |
| Steps needing a re-pick | |
| Highlights needing adjustment | |

## How it was built (process)

1. **Plan before code.** Decisions (D1–D16), UX states and architecture were written first. An independent AI reviewer critiqued the plan before any code; that caught a fake progress bar, an autosave that rewrote hundreds of MB, shortcuts that broke textareas, and a schema Gemini can't express (see the [review log](DECISIONS.md#review-log)).
2. **Design before UI code.** A Claude Design canvas covered every state. A second reviewer audited it (contrast, tab order, missing states) and the canvas was revised before the UI lanes started.
3. **Contracts, then parallel lanes.** A foundation phase wrote the shared types, error copy and component props, plus real implementations of the small shared modules. Seven agents then built lanes A–G in separate git worktrees, each owning a disjoint set of files ([IMPLEMENTATION.md](IMPLEMENTATION.md)).
4. **One reviewer per PR, merge on approval.** Every lane went through PR → review → fix rounds → squash-merge, with the merged result checked before each merge. No PR needed a third round. Deferred nits went to a Follow-ups issue.
5. **Integration in a real browser.** The E2E suite and live runs with the sample videos found what unit tests couldn't (below).

## Actual

**What changed from the plan and why**
- *Video length (D16):* the brief says under 3 minutes, but two of the provided samples are 3:33 and 5:26. So the app warns at 3 minutes and rejects at 10.
- *Undo (D12):* a floating toast became an inline "Step N deleted · Undo · Dismiss" row with focus on Undo. A toast sits last in the DOM, dozens of Tabs away.
- *Focus ring (D13):* a single blue ring vanished on blue buttons and on dark screenshots. It ended as three bands (white / blue / white).
- *Screenshots (D3):* WebP for storage, JPEG for Word, because docx can't embed WebP.

**What surprised me (found only in a real browser or with the real model)**
- `loadeddata` fires once per load, never after a seek. Waiting for it made "Enter right after an arrow key" fail about 40% of the time in the frame picker. Fixed by polling the condition.
- Gemini occasionally returns NUL characters in place of accented letters ("Requisi\u0000\u0000o"). All model text is now cleaned.
- Windows reports `.mov` files with no MIME type, so the server rejected valid recordings. The type is now inferred from the extension. Playwright's `setInputFiles` hides this bug (it infers a type), so the test builds the File in the page.
- Exporting while screenshots were still capturing produced "No screenshot" cells. Export now waits for capture.
- Gemini returns **403, not 404**, for an expired file.
- Axe flagged contrast on a dialog *mid fade-in*. The scan now waits for finite animations.

**If I had another hour**
- Keep: everything in the editor and the error taxonomy. Those are what a consultant touches all day.
- Add: custom columns / client templates (the docx builder already takes a column list), then a quality loop (flag wrong steps → eval set).
