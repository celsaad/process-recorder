# Process Recorder

Turn a screen recording into an editable **test script**: a list of steps, each with an action, description, expected result and screenshot, ready to export to Word.

Consultants currently spend up to 45 minutes documenting a 2-minute process by hand. This app uses Gemini video understanding to draft the script. The consultant then fixes what's wrong and exports.

> **Status: in development.** Features below are planned. [docs/DECISIONS.md](docs/DECISIONS.md) tracks what is planned vs built.

## Run it

Requires Node 20+ and pnpm. Runs locally only (see [D1](docs/DECISIONS.md#d1-run-locally-no-deployment-target)).

```bash
pnpm install
cp .env.example .env.local   # then set GEMINI_API_KEY
pnpm dev                     # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Server-only. Never sent to the browser. |
| `GEMINI_MODEL` | Defaults to `gemini-3.8-flash`. `gemini-2.5-flash` also works. |

## What it does

**Core:** upload a recording (MP4, MOV or WebM; best under 3 minutes, up to 10 minutes and 500 MB) → Gemini returns timestamped steps → screenshots are captured at those timestamps in the browser → an editable list of steps.

**Beyond the core:**
1. **Edit steps:** inline editing, add, delete with undo, and move up/down.
2. **Re-pick a screenshot:** scrub to a different moment in the video and use that frame.
3. **Export to Word:** a .docx table with screenshots, ready to paste into a client template.
4. **Suggested highlights:** Gemini proposes a box around the element acted on in each step. You can move, resize, remove or add one, with the mouse or the keyboard.

**Throughout:** stage-by-stage progress with cancel, specific errors that say what to do next, autosave to the browser (survives a refresh), and keyboard and screen-reader support.

**Privacy:** recordings are sent to Google's Gemini API for analysis and deleted from it when you start a new project (otherwise Gemini deletes them after 48 hours). Everything else stays in your browser.

## Documentation

| Doc | Read it for |
|---|---|
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every significant decision: context, alternatives, tradeoffs, plus the review log |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Request flow, API contracts, module map, data model |
| [docs/UX.md](docs/UX.md) | Every UI state, debouncing, keyboard flow, a11y checklist |
| [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Build plan: shared contracts and parallel lanes for concurrent agents |
| [docs/DEBRIEF.md](docs/DEBRIEF.md) | Walkthrough script and talking points for the debrief |
