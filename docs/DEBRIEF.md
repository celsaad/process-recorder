# Debrief guide

A 30-minute walkthrough. Fill in the "Actual" section and the measured numbers as the build progresses.

## 1. Framing (2 min)

- The user is a consultant documenting a process for a client. Their real cost isn't recording; it's **fixing and formatting**. So the AI produces a *draft*, and most of the product effort goes into making the draft fast to correct and easy to get into Word.
- Priorities: core loop → editing → re-pick → Word export → AI-suggested highlights.
- **Process:** I wrote the decisions down *before* coding and had an independent AI reviewer critique them. It caught real issues: a fake progress bar, an autosave that rewrote hundreds of MB, keyboard shortcuts that broke text editing, and a schema Gemini can't express. See the [review log](DECISIONS.md#review-log).

## 2. Demo script (8 min)

1. Empty state → drop a bad file (a PDF, or a video over 3 minutes) → instant, specific error. *Validation runs before any upload time or quota is spent.*
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

## Actual (fill in during the build)

- What changed from the plan and why:
- What surprised me:
- What I'd cut or keep if I had another hour:
