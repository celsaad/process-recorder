# Process Recorder

Turn a screen recording into an editable **test script**: a list of steps, each with an action, description, expected result and screenshot, ready to export to Word.

Consultants currently spend up to 45 minutes documenting a 2-minute process by hand. This app uses Gemini video understanding to draft the script in about a minute. The consultant then fixes what's wrong and exports.

> Status: in development. See [docs/DECISIONS.md](docs/DECISIONS.md) for what is planned vs built.

## Run it

Requires Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then set GEMINI_API_KEY
pnpm dev                     # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Server-only. Never sent to the browser. |
| `GEMINI_MODEL` | Defaults to `gemini-2.5-flash`. |

```bash
pnpm test    # unit tests (Vitest)
pnpm lint
```

## What it does

**Core:** upload a recording (MP4, MOV or WebM, up to 3 minutes) → Gemini returns timestamped steps → screenshots are captured at those timestamps in the browser → an editable list of steps.

**Beyond the core:**
1. **Edit steps:** inline editing, add, delete with undo, drag or keyboard reordering, and jumping to a step's moment in the video.
2. **Re-pick a screenshot:** scrub to a different moment in the video and use that frame.
3. **Export:** a Word (.docx) table with screenshots, ready to paste into a client template. Also Markdown and print/PDF.
4. **Highlights:** Gemini suggests a box around the element acted on in each step. You can move, resize, remove or draw your own, with the mouse or the keyboard.

**Throughout:** staged progress with cancel, specific errors that say what to do next, autosave to the browser (survives a refresh), and keyboard and screen-reader support.

## Documentation

| Doc | Read it for |
|---|---|
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every significant decision: context, alternatives and tradeoffs |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Request flow, module map, data model |
| [docs/UX.md](docs/UX.md) | Every UI state, error handling, keyboard map, a11y checklist |
| [docs/DEBRIEF.md](docs/DEBRIEF.md) | Walkthrough script and talking points for the debrief |
