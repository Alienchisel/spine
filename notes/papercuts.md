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

- `[edge]` 2026-07-04 — GET /api/today/card with a future `?date=` computes and persists a history row; only past dates get the `peek` guard. 88 future-locked days (from dev experimentation) were hand-deleted from the live DB on 2026-07-04; the route should refuse or peek-only future dates so it can't recur.

## Done

- `[a11y]` 2026-06-09 — BookDetail cover lightbox focus management → shipped in 1.205.8 (capture `document.activeElement` on open, focus dialog via tabIndex=-1, restore previous focus on close, mirrors ConfirmModal pattern)
- `[edge]` 2026-06-09 — `PartialDateInput` year max widened 2099 → 2199 → shipped in 1.205.9 (won't bite the spinner until 2200; min stayed at 1800 since no user acquires a book before that)
- `[ux]` 2026-06-09 — BookForm save success ack → shipped in 1.205.10 (justSaved flag in navState, BookDetail renders inline "✓ Saved." aria-live=polite with 2.5s auto-dismiss; same plumbing shape as the existing justFinished flag)
- `[ux]` 2026-06-09 — Notes empty-state recovery affordance → shipped in 1.205.11 (centered empty-state block with "Open any book and use its detail page to write a note or review." pointing at the Library home)
- `[edge]` 2026-06-09 — BookDetail final-session input stale on interleaved progress edit → shipped in 1.205.12 (`finalSessionUntouchedRef` auto-syncs draft to `book.current_page` while user hasn't typed; onChange flips untouched=false so user input isn't clobbered; reset on each prompt-open)
- `[ux]` 2026-06-09 — BookForm validation errors give no field hint → shipped in 1.205.13 (`validateBook` now emits `{ message, field }` pairs; routes echo `field` in the 400; api.js forwards it as `err.field`; BookForm uses a `FIELD_TO_TAB` map to switch to the offending field's tab and appends "(Core tab)" / "(Details tab)" / etc. to the banner)
