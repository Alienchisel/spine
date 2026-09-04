# Book Data Model

Single source of truth for the Spine book schema. Covers every field the API
accepts, how values are normalised on write, what the response shape looks like,
and how all related tables fit together.

---

## books table — scalar fields

### Identity & status

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | INTEGER PK | auto | |
| `title` | TEXT NOT NULL | — | Trimmed on write; stored value is always stripped of leading/trailing whitespace |
| `status` | TEXT | `'unread'` | `reading` · `finished` · `unread` |
| `cover_path` | TEXT | NULL | Stored as bare filename (`${timestamp}-${random}.jpg`); returned in responses as `/uploads/<filename>`. WebP uploads are converted to JPG on intake |
| `created_at` | TEXT | `datetime('now')` | ISO datetime, set once on insert |
| `updated_at` | TEXT | `datetime('now')` | ISO datetime, updated by every PUT/PATCH |

### Ownership flags

| Column | Type | Default | Notes |
|---|---|---|---|
| `owned` | INTEGER | `0` | `1` = owned; `0` = not owned |
| `previously_owned` | INTEGER | `0` | `1` = once owned, since sold/given away |
| `loved` | INTEGER | `0` | `1` = marked as a favourite |
| `archived` | INTEGER | `0` | `1` = hidden from active library; see "Archived books" below |

`owned` and `previously_owned` are mutually exclusive. If both are truthy on
write, `owned` wins and `previously_owned` is forced to `0`.

**Write-time normalization:** when `is_custom = 1`, the backend forces
`owned = 1` and `previously_owned = 0`. A custom collection is by definition
assembled by the user and currently held; the API enforces what the form's
`AcquisitionFields.jsx` already promises (toggling Custom hides the
ownership/previously-owned checkboxes and clears their values).

#### Archived books

`archived` lets the user tuck a book away without deleting it — for editions
supplanted by a newer copy, books they've moved on from but can't (or won't)
sell or give away. The flag is orthogonal to `status`, `owned`, `loved`, etc.:
a finished book you want to forget is both `finished` AND `archived = 1`.

**What changes when a book is archived:**

| Surface | Behavior |
|---|---|
| Library list, Browse, Shelf views, Readlist, Lists, facets, series-shelf | Default-hidden; opt in via `archived='any'` query param or the Archived tab |
| Library tab strip | A dedicated **Archived** tab appears alongside Owned / Prev. owned / Wishlist; its count comes from `getBookCounts().archived`. Other counters exclude archived books |
| Free-text search (`?q=...`) | **Includes** archived results so users can find a book to un-archive. Override with `archived=0` for strictly-active search |
| Stats, Diary, BookDetail page | **Always include** archived books — reading history is fact and isn't rewritten when a book is tucked away |

**Side-effects on archive-on:**

- `on_readlist` is cleared to `0` and `readlist_position` to `NULL` (the
  readlist is forward-looking and shouldn't carry archived items)
- `loved`, shelf assignment, list memberships, tags, reads rows — all preserved.
  Un-archiving restores the book to its prior state on every other axis.

**API contract:**

- `POST` and `PUT /api/books` accept `archived: true|false`
- `PATCH /api/books/:id` accepts `archived: 0|1` (and applies the readlist clear)
- `GET /api/books` query params: `archived='any'` (include both),
  `archived='1'` / `'true'` (archived only), `archived='0'` / `'false'`
  (strictly active). Default behavior: exclude archived unless a free-text
  search query is present.

### Content flags

| Column | Type | Default | Notes |
|---|---|---|---|
| `fiction` | INTEGER | NULL | `1` = fiction · `0` = non-fiction · `NULL` = unset |
| `source_type` | TEXT | NULL | `primary` · `secondary` (for non-fiction source classification) |
| `is_custom` | INTEGER | `0` | `1` = hand-entered custom entry, not from a catalogue |
| `is_stub` | INTEGER | `0` | `1` = wishlist placeholder (a book you don't own yet). Auto-cleared to `0` the moment the book becomes owned — a write that sets `owned = 1` (or `is_custom`, which forces owned). Title/author presence does **not** clear it; an owned book can't be re-flagged as a stub |

**Write-time normalization:** `source_type` is stored as `NULL` unless
`fiction === 0`. Writing a `source_type` on a fiction book or on one where
`fiction` is unset is silently scrubbed — the field is a non-fiction
classification (primary vs secondary source).

### Format & physical properties

| Column | Type | Notes |
|---|---|---|
| `format` | TEXT | `physical` · `ebook` · `audiobook` · NULL |
| `binding` | TEXT | `paperback` · `hardcover` · `other` · NULL (`other` covers leather/slipcased/boxed and anything non-standard) |
| `condition` | TEXT | `new` · `fine` · `very good` · `good` · `fair` · `poor` · NULL |
| `page_count` | INTEGER | Positive integer; NULL for audiobooks or unknown |
| `duration_minutes` | INTEGER | Positive integer; meaningful for `format = 'audiobook'` |
| `abridged` | INTEGER | `1` if this edition is abridged; `0` for complete or unset. Surfaces as the **Abridged** virtual tag |

**Write-time normalization** (mirrors the format-driven clearing in
`CoreFields.jsx` and the ownership clearing in `AcquisitionFields.jsx`):

- `binding` is stored as `NULL` unless `format = 'physical'`. It describes the
  edition (paperback / hardcover), so it's kept regardless of ownership — a
  previously-owned hardcover still carries `binding = 'hardcover'`.
- `condition` is stored as `NULL` unless `format = 'physical'` AND
  (`owned = 1` OR `is_custom = 1`). Condition describes the state of *your*
  copy, so it's only meaningful for books you currently have.
- `page_count` is stored as `NULL` when `format = 'audiobook'`.
- `duration_minutes` is stored as `NULL` when `format != 'audiobook'`.

### Identifiers

| Column | Type | Normalisation |
|---|---|---|
| `isbn_10` | TEXT | Hyphens and spaces stripped on write; validated as 9 digits + digit-or-X |
| `isbn_13` | TEXT | Hyphens and spaces stripped on write; validated as 13 digits |
| `asin` | TEXT | Uppercased on write; validated as 10 alphanumeric characters |

### Publication

| Column | Type | Notes |
|---|---|---|
| `year_published` | INTEGER | Original publication year. Negative = BCE (e.g. `-800` = 8th c. BCE Homer); year `0` is rejected |
| `year_published_approximate` | INTEGER | `1` = `year_published` is approximate (e.g. an ancient text dated "ca. 380 BCE"); `0` = exact |
| `year_edition` | INTEGER | Year of this specific edition/printing. Negative = BCE; year `0` is rejected. Feeds the Antique/Vintage virtual tags |
| `year_approximate` | INTEGER | `1` = `year_edition` is approximate; `0` = exact. **Note the split:** `year_approximate` flags the *edition* year, `year_published_approximate` flags the *published* year |
| `publisher` | TEXT | Trimmed on write |
| `series` | TEXT | Series name; trimmed on write |
| `series_number` | REAL | Position within series; allows half-numbers (e.g. `0.5`) |

### Editions (work groups)

| Column | Type | Notes |
|---|---|---|
| `work_id` | INTEGER | Non-NULL when this record is one of several editions of the same underlying work (a hardcover + paperback pair, an original + a translation, an audiobook + a physical copy). All members of a group share the same `work_id` |

The relationship is **symmetric** (every member sees every other on its
BookDetail page) and **transitive** (linking a new edition into an existing
group joins them all; linking two groups merges them into the lower-id group).
Manage it through the dedicated endpoints — never by writing `work_id` directly,
which would create an asymmetric half-linked group:

- `POST /api/books/:id/work-link { other_id }` — link `:id` and `other_id` into one group
- `DELETE /api/books/:id/work-link` — remove `:id` from its group

A genuine duplicate (not a distinct edition) is collapsed instead of linked, via
`POST /api/books/:id/merge { other_id }` — merges the loser into the `:id`
survivor in one transaction (survivor-first field fill, join-table union, reads
moved with exact-duplicate skip, reading-log same-day aggregation, work-group
inheritance, loser deleted).

### Language

| Column | Type | Default | Notes |
|---|---|---|---|
| `language` | TEXT | `'English'` | Language of this edition; defaults to `'English'` when omitted |
| `original_language` | TEXT | NULL | Original language if this is a translation |

Translators live in the `translators` / `book_translators` join tables — see
[Joined fields](#joined-fields). When `original_language` is set and differs
from `language`, the virtual tag **Translated** is applied (see
[Virtual tags](#virtual-tags)).

### Acquisition

| Column | Type | Notes |
|---|---|---|
| `acquisition_source` | TEXT | Free text (e.g. `Audible`, `Amazon`, `Library`) |
| `acquisition_date` | TEXT | Partial date: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` |

**Write-time normalization:** when `is_custom = 1`, both `acquisition_source`
and `acquisition_date` are forced to `NULL`. Custom collections are assembled
by the user, not acquired from a vendor — the form hides the acquisition
inputs in this case and the backend enforces the same contract.

### Rating & content

| Column | Type | Notes |
|---|---|---|
| `rating` | REAL | `0.5`–`5.0` in `0.5` increments; NULL = unrated |
| `description` | TEXT | Book blurb or summary |
| `notes` | TEXT | Private reader notes |
| `review` | TEXT | Reader's review |

### Reading progress

| Column | Type | Notes |
|---|---|---|
| `current_page` | INTEGER | Current reading position; set by PATCH |
| `current_minutes` | INTEGER | Current listening position (minutes); set by PATCH |
| `read_count` | INTEGER | `0` by default. Incremented by 1 when `status` transitions from any non-`finished` value to `'finished'` via PUT. Can be set to an arbitrary value by including `read_count` explicitly in a PUT. |

> **`date_started` / `date_finished` are no longer book columns.** They were
> dropped in migration `079` (Phase 3). They're still accepted as *payload*
> fields on POST/PUT/PATCH, but the backend routes them to the `reads` table
> (a finish-transition inserts a reads row; off-transition edits update the
> latest reads row) — see [Reading data rules](#reading-data-rules). The
> `reads` table is the single source of truth for per-read dates.

### Readlist

| Column | Type | Notes |
|---|---|---|
| `on_readlist` | INTEGER | `1` = book is on the to-read list |
| `readlist_position` | INTEGER | Sort order on the readlist; NULL when not on list |

Added to readlist via `PATCH { on_readlist: true }`, which appends at the end
(position = current max + 1). Removed via `PATCH { on_readlist: false }`, which
clears `readlist_position` to NULL.

Order is rewritten by `PUT /api/readlist/order`.

### Location (shelf hierarchy)

A book may be assigned to at most one level of the shelf hierarchy. Only the
most specific field is stored; the rest are forced to NULL on write.

| Priority | Column | Type | Stored when |
|---|---|---|---|
| 1 (most specific) | `shelf_id` | INTEGER → shelves.id | Shelf assigned; all other location fields stored as NULL |
| 2 | `unit_id` | INTEGER → units.id | Unit assigned, no `shelf_id`; `room_id` and `building_id` stored as NULL |
| 3 | `room_id` | INTEGER → rooms.id | Room assigned, no `shelf_id` or `unit_id`; `building_id` stored as NULL |
| 4 (least specific) | `building_id` | INTEGER → buildings.id | Only when `shelf_id`, `unit_id`, and `room_id` are all absent |

When multiple location fields are present in a write payload, the most specific
non-null value wins and all less-specific fields are silently cleared.
Normalisation is applied by `normalizeBookLocation()` in `lib/books/normalization.js`.

**Write-time normalization:** the entire location chain is stored as `NULL`
unless the book is both `format = 'physical'` (or unset) AND `owned = 1`
(or `is_custom = 1`). Books that are previously-owned, never-owned, or
non-physical can't hold a shelf assignment — direct API writes with shelf
data are silently scrubbed, mirroring `AcquisitionFields.jsx` which only
shows the shelf picker when `owned && format === 'physical'`.

#### Shelf ordering

| Column | Type | Notes |
|---|---|---|
| `shelf_position` | INTEGER | Sort position within a shelf; rewritten by `PUT /api/shelf/shelves/:id/order` |

The four shelf-hierarchy drilldowns (`/shelves/:id/books`, `/units/:id/books`,
`/rooms/:id/books`, `/buildings/:id/books`) return positioned books first
(ordered by `shelf_position`); the rest fall back to article-stripped
`COALESCE(series, title)`, then `series_number`, then article-stripped `title`.
Books with no series interleave alphabetically with series-tagged books rather
than floating to the top.

`/unshelfed` is structurally different — by definition its books have no
location, so there's no `shelf_position` branch and no series grouping. It
sorts purely by article-stripped `title`.

Article-stripping everywhere uses the same `titleSortExpr` as Library browsing,
so *The Odyssey* sorts under `O` rather than `T`.

### System & dormant columns

A few `books` columns exist in the schema but aren't user-facing fields, so
they're omitted from the tables above on purpose:

- `cover_bytes` — system-managed cover size cache; written on cover save, not by the API.
- `showcase_position` — system-managed ordering for the (planned) showcase surface.
- `desire_rank` — **dormant**: fed the removed Library "Custom order" sort (dropped in 1.273.0). ~109 rows still carry values; no code reads or writes it. Kept intentionally — see the "Dormant schema" note in `CLAUDE.md`.

---

## Joined fields

These are not columns on `books`; they are assembled from join tables and
returned with every book response.

### authors

```
books ──< book_authors >── authors
               │
           position (INTEGER, 0-indexed)
```

- `authors` table: `id`, `name` (unique, case-insensitive)
- `book_authors` table: `book_id`, `author_id`, `position`. Composite primary
  key on `(book_id, author_id)` — a book cannot hold the same author twice in
  this role. The same applies to `book_narrators` and `book_translators`.
- Passed to API as an array of strings: `["Frank Herbert", "Brian Herbert"]`
- Returned as an array of objects ordered by `position`: `[{ id, name }, …]`
- On every write (POST or PUT with `authors` key present), all existing rows are
  deleted and re-inserted from scratch. Omitting the `authors` key on PUT
  leaves existing authors untouched.
- Deduplication is case-insensitive within a single sync. The `authors` entity
  row is reused across books (same `author.id` for the same name).

### narrators

Identical structure to authors, using `narrators` / `book_narrators` tables.

```
books ──< book_narrators >── narrators
                │
            position (INTEGER, 0-indexed)
```

### translators

Identical structure to authors, using `translators` / `book_translators` tables.

```
books ──< book_translators >── translators
                │
            position (INTEGER, 0-indexed)
```

Returned as `translators: [{ id, name }, …]`. Replaced wholesale on every PUT
that includes a `translators` key.

The Library `Missing → Translator` filter (`?missing[]=translator`) applies
only to translated books: `original_language` must be set *and* no
`book_translators` row exists. Untranslated books are not flagged as
"missing translator", since the field is genuinely not applicable.

### tags

```
books ──< book_tags >── tags
```

- `tags` table: `id`, `name` (unique, COLLATE NOCASE)
- Passed as an array of strings; returned as `[{ id, name }, …]` ordered by
  name, followed by any virtual tags (see below).
- Fully replaced on every PUT that includes a `tags` key.
- Tag entity rows are reused across books.

---

## Virtual tags

Virtual tags are computed at read time from book fields. They are never stored
in the database. In responses they appear appended after real tags and carry
`"virtual": true`.

| Name | Condition |
|---|---|
| **Antique** | `format = 'physical'` and `year_edition` set and `(current_year − year_edition) ≥ 100` |
| **Vintage** | `format = 'physical'` and `year_edition` set and `50 ≤ (current_year − year_edition) < 100` |
| **Translated** | `original_language` set and differs from `language` |
| **Re-read** | `read_count > 1` |
| **Abridged** | `abridged = 1` |
| **Long** | `(500 ≤ page_count < 1000)` OR `(840 ≤ duration_minutes < 1680)` — bounded above so it's mutually exclusive with Tome |
| **Tome** | `page_count ≥ 1000` OR `duration_minutes ≥ 1680` (~28+ hours) — the superlative of Long |
| **Short** | `(0 < page_count ≤ 150)` OR `(0 < duration_minutes ≤ 240)` |

Antique and Vintage are gated to physical-format books because they signal a
physically older copy (a 1900 hardcover), not the age of the underlying text
(an 1841 treatise reissued as a 2021 audiobook should not qualify).

Virtual tags also appear in `GET /api/books/facets` and support filtering via
`?tags[]=Long` etc. The SQL fragment for each rule is evaluated server-side.

---

## Reading data rules

Three separate stores track reading activity. They are intentionally decoupled
so that retroactive or partial data entry is always possible.

### Sources of truth

| Field / table | Source of truth | Can drift from others? |
|---|---|---|
| `books.read_count` | Authoritative count of how many times the book has been read | Yes — by design |
| `reads` rows | The record of individual read-throughs, and the **single source of truth for per-read `date_started` / `date_finished`** (the book-level date columns were dropped in Phase 3) | Row count may differ from `read_count` |
| `reading_log` rows | Daily progress deltas; never decremented | Independent of `reads` and `read_count` |

### read_count rules

`read_count` has two write paths, applied in priority order:

1. **Manual override** — if a PUT body includes `read_count` and the value
   differs from the stored value, that value is used directly. This is
   intentional: it supports correction and retroactive import ("I've actually
   read this five times"). The frontend's BookForm exposes a "Times read" field
   for exactly this purpose.

2. **Auto-increment** — if no manual override is present and `status`
   transitions from any non-`finished` value to `'finished'` in a PUT, the
   stored count is incremented by 1.

`read_count` is **not derived from `reads` row count**. A book can have
`read_count = 4` with zero `reads` rows (read several times, no detailed logs),
or three `reads` rows with `read_count = 1` (logs added manually, no finish
transition recorded). Both states are valid.

The virtual tag **Re-read** fires when `read_count > 1`, regardless of how many
`reads` rows exist.

### reads rows

A finish-transition (a `PUT` whose `status='finished'` and whose stored
status was anything else) auto-INSERTs one `reads` row inside the same
transaction, using the payload's `date_started` and `date_finished` (NULL
when the user doesn't know). This keeps the per-completion log in sync with
`read_count` for the common path without forcing a second round-trip from
the client.

`POST /api/books/:id/reads` is still available for explicit logging — used
when you want to backfill an old read with specific dates, or log multiple
reads on a book without status-toggling. Creating a `reads` row this way
does **not** increment `read_count` (the two stores remain decoupled per
the rules above; this lets you log five separate readings while keeping
`read_count = 1` if you'd rather count it as a single work-experience).

`POST /api/books/:id/reread` is the third path: an atomic re-read shortcut
for an already-finished book. It bumps `read_count` by 1 and inserts a
`reads` row inside the same transaction, using optional `date_started` /
`date_finished` (partial dates accepted, same shape and ordering rule as
`/reads`). Status doesn't change — this fires no finish-transition because
the book is already `finished` — so without this endpoint the client would
need a `PUT` for the count and a separate `POST /reads` for the log row,
risking half-applied state on partial failure. The BookDetail "Log a
re-read" button calls this endpoint when the book's status is `finished`;
in-progress books still see the plain "Log a read" affordance that hits
`POST /reads`.

### date_started / date_finished (payload fields, not columns)

These are **not** stored on `books` (the columns were dropped in Phase 3,
migration `079`). They remain accepted on the POST/PUT/PATCH payload as a
convenience, and the backend routes them into the `reads` table:

- On a **finish-transition** (status → `finished`), they become the
  `date_started` / `date_finished` of the auto-inserted `reads` row.
- On an **off-transition** edit that includes them, they update the latest
  `reads` row via `syncLatestReadsRow()`.

So per-read dates live only in `reads` rows; there is no book-level "most
recent finish date" column. Surfaces that need "when did I last finish this"
derive it from `MAX(reads.date_finished)`.

## Progress tracking

Progress is updated via `PATCH /api/books/:id` and drives two side effects.

### reading_log

Whenever `current_page` increases or `current_minutes` increases, the delta is
upserted into `reading_log` for today's date:

```
reading_log(book_id, date) ON CONFLICT → pages_read += delta, minutes_read += delta
```

Multiple PATCHes on the same day accumulate. The log never decrements.

### reads table

The `reads` table stores discrete read-through records (a book can be read many
times). Each row has `date_started`, `date_finished`, and `book_id`. Managed
independently via `POST/PUT/DELETE /api/books/:id/reads`.

---

## Related tables

### reads

Records of individual read-throughs.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `book_id` | INTEGER | → books.id ON DELETE CASCADE |
| `date_started` | TEXT | Partial date: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` · nullable |
| `date_finished` | TEXT | Partial date: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` · nullable; must not be before `date_started` |
| `did_not_finish` | INTEGER | `1` = a DNF read (abandoned); `0` = completed. Read by the finish-transition dedup guard and by the diary/collage finish indicators |
| `created_at` | TEXT | |

The "must not be before" comparison runs on the shared prefix of the two
values, so mixed-precision pairs like `started='2024-06'` / `finished='2024'`
are accepted (shorter date treated as a span on its common prefix), while
clearly out-of-order pairs like `started='2024-06'` / `finished='2023'` are
still rejected.

API: `GET/POST /api/books/:id/reads`, `PUT/DELETE /api/books/:id/reads/:readId`,
`POST /api/books/:id/reread` (atomic `read_count++` + reads-row insert).

### reading_log

Daily reading activity. One row per (book, date); upserted by PATCH.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `book_id` | INTEGER | → books.id ON DELETE CASCADE |
| `story_id` | INTEGER | → stories.id · nullable. Set for a story-level reading-log row (an anthology story read on its own); NULL for a book-level row |
| `date` | TEXT | `YYYY-MM-DD` |
| `pages_read` | INTEGER | Accumulated for the day |
| `minutes_read` | INTEGER | Accumulated for the day |

Uniqueness is a **partial** index — `UNIQUE(book_id, date) WHERE story_id IS
NULL` — so a book-level row is one-per-(book, date), while story-level rows
(each carrying a `story_id`) can coexist on the same day. The upsert uses
`ON CONFLICT(book_id, date) WHERE story_id IS NULL`. Used by `GET /api/stats`
to compute streaks, total pages read, and total minutes listened (with
book-level rows de-duplicated against story-level rows so an anthology day
isn't double-counted).

API: `GET /api/books/:id/log`

### stories / story_authors

Table-of-contents entries for a container book (an anthology, a collection, a
periodical). Each story is a child of one book and can be read, rated, and
finished independently of its parent — a story-level finish writes a
`reading_log` row carrying the story's `story_id`, and the parent auto-rolls to
`finished` once every story is accounted for.

| Table | Key columns |
|---|---|
| `stories` | `id`, `book_id` (→ books.id ON DELETE CASCADE), `title`, `position` (order within the TOC), `status`, `date_finished` (partial date), `rating`, `did_not_finish`, `notes`, `page_start`, `page_end`, `year_published`, `created_at`, `updated_at` |
| `story_authors` | `story_id`, `author_id`, `position` — per-story contributors (an anthology author bylined on one story but not the containing book) |

API: `GET/POST /api/books/:id/stories`, `PUT/DELETE /api/books/:id/stories/:storyId`

### lists / list_books

Curated lists of books.

| Table | Key columns |
|---|---|
| `lists` | `id`, `name` (unique NOCASE, max 200 chars), `description` (max 2000 chars, trimmed-to-NULL), `default_sort` (a `LIST_ORDER_BY` key remembered per list, or NULL), `created_at`, `updated_at` |
| `list_books` | `list_id`, `book_id` (composite PK), `position`, `added_at` |

Books are appended at position = max + 1. Order is rewritten by
`PUT /api/lists/:id/order`. A book can appear in multiple lists.

API: `GET/POST/PUT/DELETE /api/lists`, `POST /api/lists/:id/books`,
`PUT /api/lists/:id/order`, `DELETE /api/lists/:id/books/:bookId`

### Shelf hierarchy

Four-level tree: **building → room → unit → shelf**.

| Table | Key columns |
|---|---|
| `buildings` | `id`, `name`, `proximity` (`home`·`nearby`·`remote`), `notes`, `order_index` |
| `rooms` | `id`, `building_id`, `name`, `order_index` |
| `units` | `id`, `room_id`, `name`, `order_index` |
| `shelves` | `id`, `unit_id`, `label`, `order_index` |

Books reference a single level via `shelf_id` / `unit_id` / `room_id` /
`building_id` (at most one set; see [Location](#location-shelf-hierarchy)).

`GET /api/shelf/location/:bookId` returns a breadcrumb from whatever level the
book is assigned at upward to the building. `GET /api/shelf/unshelfed` returns
owned physical (or format-unset) books with no location assigned.

API: `GET/POST/PUT/DELETE` endpoints under `/api/shelf/buildings`,
`/api/shelf/rooms`, `/api/shelf/units`, `/api/shelf/shelves`, plus
`/api/shelf/tree`, `/api/shelf/unshelfed`, `/api/shelf/location/:bookId`,
and book-listing endpoints (`/api/shelf/buildings/:id/books`, etc.).

---

## Search DSL

`GET /api/books?q=<query>` accepts a Google-style boolean DSL. Each atom is
matched by `LIKE '%term%'` against six surfaces — `title`, `series`, `tag.name`,
`author.name`, `narrator.name`, `translator.name` — joined with OR. The DSL
combines those atoms with the operators below.

| Operator | Example | Meaning |
|---|---|---|
| Whitespace (implicit AND) | `Sci-Fi Manga` | Match books with **both** terms |
| Uppercase `OR` | `Naval OR 40k` | Match either term |
| Quoted phrase | `"Heart of Darkness"` | Literal substring match |
| `-` prefix or uppercase `NOT` | `fantasy -manga` · `fantasy NOT manga` | Exclude books matching the operand |
| Parentheses | `(Naval OR 40k) War` | Group sub-expressions |
| Qualifier `name:value` | `author:vance` · `tag:"Loeb Classical Library"` | Pin the atom to one surface |

The supported qualifier names are `title`, `series`, `tag`, `author`,
`narrator`, `translator`, and `publisher`. `publisher:` is the **only** way
to search the publisher column — it isn't part of the bare-term default
surfaces. `tag:` matches stored tags only; virtual tags (`Long`, `Translated`,
`Re-read`, …) are computed from book columns and aren't joined through
`book_tags`, so use the FilterPanel for those. An unknown qualifier
(`foo:bar`) falls through to a plain term.

Lowercase `or` and `not` are deliberately treated as literal terms, so book
titles like *Pride or Prejudice* or *Stranger Than Fiction: True Stories* don't
get parsed as boolean expressions. `OR` and `NOT` must be uppercase to act as
operators — same convention as Google.

Edge-case handling that doesn't surprise the user:

- An unmatched `)` is silently dropped before parsing (so `dune))) frank` is
  treated as `dune frank`, not as `dune` with the rest swallowed).
- An unmatched `"` runs to end-of-input as a phrase.
- `-` before `(` or `"` negates the whole group/phrase (`-(a OR b)`,
  `-"phrase"`), matching Google's behavior.

Implemented in `lib/books/searchQuery.js` (tokenizer + recursive-descent parser
+ SQL builder); wired into `lib/books/filters.js` via `buildSearchCondition`.
