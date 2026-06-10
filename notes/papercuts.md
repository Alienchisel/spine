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
- `[ux]` 2026-06-09 — BookForm save success has no toast or confirmation — silent navigate to BookDetail. Easy to wonder "did it save?" on a slow connection. Minor; only matters when network is laggy.
- `[edge]` 2026-06-09 — `PartialDateInput` year input hardcodes `min="1800" max="2099"`. Fine for acquisition / reading dates today but won't survive 2100, and an acquisition pre-1800 (rare collector case) would be silently capped. (`client/src/components/PartialDateInput.jsx:51`)
- `[a11y]` 2026-06-09 — BookDetail cover lightbox doesn't move focus on open and doesn't restore it to the cover thumbnail on Esc-dismiss. Esc keydown listener fires regardless of focus so dismiss works, but keyboard users land on body afterward. Add focus-trap + return-focus shape similar to ConfirmModal. (`client/src/pages/BookDetail.jsx` lightbox useEffect ~line 113)
- `[edge]` 2026-06-09 — BookDetail final-session input initializes from `current_page` at open and doesn't track edits made in ProgressSection while the form is visible. Save logic compares against current `book.current_page` so no bad write, but the visual input shows stale value. Rare interleaving. (`client/src/pages/BookDetail.jsx` final-session draft state)
- `[ux]` 2026-06-09 — Notes empty-state ("No notes or reviews written yet.") has no recovery affordance. Add "Start writing notes on any book's detail page" or a link to e.g. `/?tab=reading`. Low priority — discoverable via BookDetail. (`client/src/pages/Notes.jsx` empty-state branch)

## Done

<!-- move entries here as they're addressed, keep one line on what shipped -->
