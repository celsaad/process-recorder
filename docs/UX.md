# UX states, keyboard map and accessibility

## Screen states

| State | What's on screen | Focus / announcement |
|---|---|---|
| **Empty (first visit)** | Dropzone ("Drop a screen recording or choose a file"), accepted formats, 3-minute limit, a 3-step "how it works" | Page heading. Dropzone is the first tab stop after the header |
| **Restored project** | The editor with the last project, plus a "Start new" button | Polite announcement: "Restored your last project" |
| **Validating** | Brief inline spinner on the dropzone (milliseconds) | None |
| **Uploading** | Stage list (Upload ▸ Process ▸ Analyze ▸ Screenshots), progress bar with %, file name/size, **Cancel** | Live: "Uploading, 40%" (in 10% steps) |
| **Processing / Analyzing** | Same stage list. Indeterminate bar with elapsed time and "usually 20–60 s" | Live: stage name on change |
| **Capturing** | Step cards render immediately with skeleton screenshots that fill in one by one ("Screenshots 3/12") | Live: "Capturing screenshots" |
| **Ready** | Editor: title, step cards, export menu, save indicator | Focus moves to the results heading. Live: "12 steps ready" |
| **No steps** | Explanation + "Add a step manually" + "Regenerate" | Focus on the message |
| **Error** | Error panel with cause, what to do, and primary action (see DECISIONS D10) | `role="alert"`, focus on the panel |
| **Cancelled** | Back to the dropzone | Live: "Cancelled" |

Double submits are prevented: the dropzone is disabled during a job, and dropping a new file while a project exists asks "Replace current project?".

## Debounce / throttle

| Where | Strategy | Why |
|---|---|---|
| Step field edits → IndexedDB | Debounce 500 ms + flush on `pagehide` / `visibilitychange` | Don't write MBs on every keystroke. Never lose the last edit |
| Upload progress → live region | Announce only on 10% boundaries | Don't flood screen readers |
| Frame-picker scrubbing → preview | Only one seek in flight. The latest requested time wins | Seeking is async. Queuing every input event makes it lag behind the cursor |
| Highlight drag → state | `requestAnimationFrame`-batched updates, commit on pointer-up | Smooth drag without re-rendering the list per pixel |
| Rate-limit retry | Exponential backoff with jitter (max 3 attempts), countdown shown | Visible and cancellable |

## Keyboard map

| Context | Keys | Action |
|---|---|---|
| Global | `Tab` / `Shift+Tab` | Logical order: header → dropzone or steps → export |
| Step card | `⌘↑` / `⌘↓` (Ctrl on Windows) | Move step up / down |
| Step card | `⌘⌫` | Delete step (undo toast) |
| Drag handle | `Space`, arrows, `Space` | dnd-kit keyboard reorder, with announcements |
| Frame picker | `←` / `→` | ±0.1 s (`Shift` = ±1 s) |
| Frame picker | `Enter` / `Esc` | Use this frame / cancel |
| Highlight | Arrows (`Shift` = 10×) | Move. `Alt+arrows` resize |
| Highlight | `Delete` | Remove |
| Toast | `⌘Z` | Undo the last delete |

Shortcuts are listed in a "Keyboard shortcuts" dialog (`?`).

## Accessibility checklist (WCAG 2.2 AA)

- [ ] Landmarks and one `h1`. Steps are a list (`ol`) of `article`s with headings "Step N"
- [ ] Every control is reachable and operable by keyboard. No keyboard traps outside modal dialogs
- [ ] Visible focus indicator on every interactive element
- [ ] All inputs labelled. Icon buttons have `aria-label` (e.g. "Delete step 3")
- [ ] One polite live region for status. Errors use `role="alert"`
- [ ] Focus moved deliberately on phase changes and dialog close
- [ ] Screenshot `alt` = step action. Decorative icons are `aria-hidden`
- [ ] Text and UI contrast ≥ 4.5:1 / 3:1
- [ ] `prefers-reduced-motion` respected
- [ ] Target size ≥ 24×24 px (WCAG 2.5.8)
- [ ] Drag operations have a non-drag alternative (WCAG 2.5.7): move buttons, keyboard highlight editing
- [ ] axe DevTools: zero violations on empty, progress, ready and error states
