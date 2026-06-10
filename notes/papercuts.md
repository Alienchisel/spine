# Papercuts

Small frictions noticed during real use of Spine, captured here in the
moment so they don't need to be remembered. Items get added (by the
user or by Claude when something small-but-real surfaces mid-task) and
harvested when there's bandwidth — turned into fixes or aged out if
they stop mattering.

Keep entries tight: one line each, file:line where relevant, no triage
beyond a leading category tag in brackets. The point is fast capture,
not careful taxonomy. Date the entry so harvest can prefer fresh items.

Categories worth using: `[ux]`, `[perf]`, `[a11y]`, `[copy]`, `[edge]`,
`[data]`, `[viz]`, `[dx]` (developer experience).

## Open

- `[ux]` 2026-06-09 — BookForm validation errors land in a single top-of-page banner; for long edits the user can't tell which field caused a 400 (e.g. source_type vs fiction conflict). Consider parsing the server's error message to highlight the offending field. (`client/src/pages/BookForm.jsx` save handler ~ line 463)

## Done

- `[a11y]` 2026-06-09 — BookDetail cover lightbox focus management → shipped in 1.205.8 (capture `document.activeElement` on open, focus dialog via tabIndex=-1, restore previous focus on close, mirrors ConfirmModal pattern)
- `[edge]` 2026-06-09 — `PartialDateInput` year max widened 2099 → 2199 → shipped in 1.205.9 (won't bite the spinner until 2200; min stayed at 1800 since no user acquires a book before that)
- `[ux]` 2026-06-09 — BookForm save success ack → shipped in 1.205.10 (justSaved flag in navState, BookDetail renders inline "✓ Saved." aria-live=polite with 2.5s auto-dismiss; same plumbing shape as the existing justFinished flag)
- `[ux]` 2026-06-09 — Notes empty-state recovery affordance → shipped in 1.205.11 (centered empty-state block with "Open any book and use its detail page to write a note or review." pointing at the Library home)
- `[edge]` 2026-06-09 — BookDetail final-session input stale on interleaved progress edit → shipped in 1.205.12 (`finalSessionUntouchedRef` auto-syncs draft to `book.current_page` while user hasn't typed; onChange flips untouched=false so user input isn't clobbered; reset on each prompt-open)
