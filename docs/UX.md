# UX states, keyboard flow and accessibility

## Screen states

| State | What's on screen | Focus / announcement |
|---|---|---|
| **Empty (first visit)** | Dropzone (button "Choose a recording", hint "or drop a file here"), accepted formats, 10-minute / 500 MB limits ("best under 3 minutes"), a 3-step "how it works" | Page heading. Dropzone is the first tab stop after the header |
| **Restored project** | The editor with the last project, plus "Start new" | Status: "Restored your last project" |
| **Validating** | Brief inline spinner on the dropzone (milliseconds) | None |
| **Uploading** | Stage list (Receiving ▸ Sending to Gemini ▸ Gemini processing ▸ Analyzing ▸ Screenshots), with elapsed time on the active stage, an indeterminate bar, file name/size, **Cancel** | Status: stage name on each change |
| **Long video (3:00–10:00)** | Info notice (not an error) in the progress screen and at the top of the editor: "This recording is 5:26. Longer recordings take longer to process and are more likely to miss steps." (D16) | Included in the stage announcement once |
| **Analyzing** | Same stage list | Status: "Analyzing steps" |
| **Capturing** | Step cards render immediately with skeleton screenshots that fill in one by one ("Screenshots 3/12") | Status: "Capturing screenshots". Focus stays put |
| **Ready** | Editor: title, step cards, Export button, save indicator | Focus moves to the results heading **after** capture ends. Status: "12 steps ready" |
| **No steps** | Explanation + "Add a step manually" | Focus on the results heading (the process title), same as Ready. Status: "No steps found. Add a step manually." |
| **Error** | Error panel: cause, what to do, primary action (see DECISIONS D10) | Focus on the panel heading (no `role="alert"`, to avoid double announcements) |
| **Storage full** | Persistent banner: "Changes won't survive a refresh. Export now." | Status message |
| **Cancelled** | Back to the dropzone | Status: "Cancelled" |

**Double submits are prevented.** The dropzone is disabled during a job. Dropping a new file while a project exists asks "Replace current project?". "Start new" confirms before clearing local data and the Gemini file.

**Honesty rule.** No fake percentages. The upload to localhost is near-instant, so stages and elapsed time tell the user where the time actually goes (DECISIONS D4).

## Debounce / throttle

| Where | Strategy | Why |
|---|---|---|
| Step field edits → IndexedDB `project` key | Debounce 500 ms + best-effort flush on `pagehide` | Write only the JSON on typing pauses. Blobs are written separately, once |
| Frame-picker scrubbing → preview | Only one seek in flight. The latest requested time wins | Seeking is async. Queuing every input event makes the preview lag behind the cursor |
| Highlight drag → state | `requestAnimationFrame`-batched overlay updates, committed on pointer-up | Smooth drag without re-rendering the step list per pixel |
| Elapsed-time counter | 1 s interval, *not* announced to screen readers | Visual only. Announcing it would flood screen readers |

## Keyboard flow

There are deliberately **no custom shortcuts inside step cards**. The fields are textareas, and on macOS ⌘↑/↓, ⌘⌫ and ⌘Z already mean things there (DECISIONS D12). Keyboard users rely on Tab order and labelled buttons:

| Context | Keys | Action |
|---|---|---|
| Page | `Tab` / `Shift+Tab` | Header → dropzone or step list → Export |
| Step card | `Tab` | Timestamp → Action → Description → Expected result → Highlight (when present) → Pick frame → Add/Remove highlight → Reset (when suggested) → Move up → Move down → Delete |
| Move up / down | `Enter` / `Space` | Moves the step. Focus stays on the same button, now in its new position. Status: "Step moved to position 2" |
| Delete | `Enter` / `Space` | An inline "Step N deleted · Undo · Dismiss" row replaces the card, and **focus moves to its Undo button**. `Tab` continues to Dismiss, then the next step. After Dismiss, focus goes to the next step (the previous one if it was last) |
| Move up / down at the ends | `Enter` / `Space` | No-op: the button is `aria-disabled`, not `disabled`, so it keeps focus |
| Frame picker (dialog) | `←` / `→` on the slider | ±0.1 s (`Shift` = ±1 s) |
| Frame picker | `Enter` on the slider / `Esc` | Use this frame / cancel (focus returns to the trigger). `Enter` on a ± button only steps |
| Highlight (focused, in the card) | Arrows / `Shift` + arrows / `Alt` + arrows / `Delete` | Move / move 10× / resize / remove. Instructions are read via `aria-describedby` |
| Project title | `Enter` / `Esc` (after "Rename") | Save / cancel the new title |
| Export options (dialog) | `Tab` | Preset select → per column: Show checkbox → Header input → Move up → Move down → Remove (blank columns) → Add blank column → Save as preset → Done. `Esc` closes; focus returns to "Export options". After Remove, focus goes to the next column (the previous one if it was last) |

## Accessibility checklist (target WCAG 2.2 AA; verify with a keyboard walkthrough + axe, record gaps)

- [ ] Landmarks and one `h1`. Steps are an `ol` of `article`s, each with a heading "Step N"
- [ ] Every control is reachable and operable by keyboard. No traps outside modal dialogs
- [ ] Visible focus indicator on every interactive element
- [ ] All inputs labelled. Icon buttons have `aria-label` (e.g. "Delete step 3")
- [ ] One polite live region for status. Errors are announced by moving focus, not also by `role="alert"`
- [ ] Focus moved deliberately: after capture, after delete, on error, on dialog close
- [ ] Screenshot `alt` = "Screenshot for step N". Decorative icons are `aria-hidden`
- [ ] No time limits: the inline Undo row stays until dismissed (2.2.1)
- [ ] Two-tone focus ring visible on white, grey and dark surfaces
- [ ] End-of-list Move buttons are `aria-disabled` and keep focus
- [ ] Visible labels are a prefix of accessible names (2.5.3). Repeated buttons include the step number
- [ ] Text and UI contrast ≥ 4.5:1 / 3:1
- [ ] `prefers-reduced-motion` respected
- [ ] Target size ≥ 24×24 px (2.5.8)
- [ ] Every drag has a non-drag alternative (2.5.7): move buttons, keyboard and button controls for highlights

**Known gaps:** (fill in after the axe pass)
