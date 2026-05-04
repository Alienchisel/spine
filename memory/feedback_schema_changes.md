---
name: Schema changes require full stack updates
description: Every schema change must update the migration, the BOOK_TABLE_COLUMNS list, bookColumns() normalization, the form, and the detail page.
type: feedback
---

For every new field or schema change, walk the full stack:

1. **Migration** — new `.sql` file in `migrations/` with `ALTER TABLE` or new table.
2. **Column list** — add the column name to `BOOK_TABLE_COLUMNS` in `shared/bookFields.js`. This is the single source of truth that drives the INSERT / UPDATE column ordering for every books-table write.
3. **Normalization** — add a key for the new column in `bookColumns()` in `lib/books/repository.js` with whatever coercion / write-time gating the field needs (`t()` for trim+null, format/owned gates, etc.). The startup coverage check at the bottom of that section throws on module load if `BOOK_TABLE_COLUMNS` and `bookColumns()` drift apart, so a missing key surfaces immediately rather than silently storing NULL.
4. **Validation** *(optional)* — if the field has a typed contract (enum, regex, date format), add it to `validateBook()` in `lib/books/validation.js`.
5. **Form** — add to the `EMPTY` state, load in the edit `useEffect`, add the input to the appropriate `bookForm/*Fields.jsx` panel, and ensure the submit payload parses it correctly.
6. **Detail page** — display the field on `BookDetail.jsx` if it makes sense (this overlaps with the `feedback_book_detail_page` memory; both apply).

**Note:** routes/books.js POST/PUT *don't* destructure individual fields — they just pass `req.body` to `createBook()` / `updateBook()`. So the route layer rarely needs touching for new fields. The work happens in `BOOK_TABLE_COLUMNS` + `bookColumns()`.

**Why:** Fields added to the DB but missed in `BOOK_TABLE_COLUMNS` / `bookColumns()` silently store NULL or fail the startup check. Fields missed on the form are unwritable from the UI; missed on the detail page are invisible to the user. Easy to miss one layer during a quick change.

**How to apply:** Treat it as a checklist on every schema change — migration → column list → normalization → (validation) → form → detail.
