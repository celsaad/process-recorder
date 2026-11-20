# Debrief guide

A 30-minute walkthrough. Fill in the "Actual" notes as the build progresses.

## 1. Framing (2 min)

- The user is a consultant documenting a process for a client. Their real cost isn't recording; it's **fixing and formatting**. So the AI produces a *draft*, and most of the product effort goes into making the draft fast to correct and easy to get into Word.
- Priorities: core loop first → editing → re-pick → export → AI-suggested highlights. Custom columns were cut on purpose (DECISIONS D15).

## 2. Demo script (8 min)

1. Empty state → drop a bad file (e.g. a PDF or a >3-minute video) → instant, specific error. *Validation before spending upload time or quota.*
2. Drop a real recording → staged progress → **cancel** → drop again.
3. Results: screenshots fill in → edit a step → reorder **with the keyboard** → delete → undo.
4. Re-pick a frame with the scrubber (arrow keys).
5. Adjust a Gemini-suggested highlight. Draw one.
6. **Refresh the page**: everything is still there.
7. Export to Word → open the file.

## 3. Technical choices worth explaining (10 min)

| Topic | One-liner | Ref |
|---|---|---|
| Screenshots in the browser | No ffmpeg. Re-pick is free. Native resolution | D3 |
| Upload/analyze split | XHR for upload progress, streamed fetch for analysis, retry without re-upload | D4 |
| Schema + zod + 1 retry | Turns LLM weirdness into a typed, handleable error | D5 |
| Which frame | Before the action, plus a highlight on where to act | D6 |
| State machine | Impossible states unrepresentable. Each phase has one UI and one announcement | D7 |
| IndexedDB autosave | The user's editing time is the most valuable thing in the app | D8 |
| Highlights as data | Editable forever. Composited only on export | D9 |
| Error taxonomy | Every error has a cause, message and next action | D10 |

## 4. What I'd do next (5 min)

- **Production upload path:** direct-to-storage upload, job queue + SSE so a closed tab doesn't kill a job (D1, D15).
- **Custom columns / client templates:** column config feeding the editor and docx builder. Upload a client's .docx template and map fields.
- **Quality loop:** let users mark steps as wrong. Use those as eval cases for prompt and model changes. Compare Flash vs Pro on the example set.
- **Playwright e2e tests** with a recorded Gemini response fixture.
- **Collaboration:** projects stored server-side, share links, comments for reviewers.

## 5. Risks and what I'd check with users

- Timestamp drift (±1 s) → the re-pick flow mitigates it. Measure how often users re-pick.
- Sensitive client data in recordings sent to a third-party API → needs a data-processing agreement and maybe blur/redaction before export.
- Long or noisy recordings (idle time, mistakes) → the prompt asks Gemini to skip non-actions. Users can delete steps.

## Actual (fill in during the build)

- What changed from the plan and why:
- What surprised me:
- What I'd cut or keep if I had another hour:
