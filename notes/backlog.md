# Backlog

Feature-scale aspirations — the things too big for papercuts.md and
too slow-moving to keep in anyone's head. Items graduate out when they
ship; add context inline so a cold read is enough to start the work.

Papercuts (small frictions, one-liners) stay in `notes/papercuts.md`.

## Open

### Showcase section
A curated top-five favourite books display — hand-ordered, large
covers, minimal text, "bookshelf portrait" feel. Distinct from the
Loved list: this is personal curation and aesthetic display, not
discovery or filtering. Intentionally capped at five.

Open question: placement. Options discussed — its own page
(ceremonial), a pinned strip on Library, or a sidebar spot. Undecided;
settle this before building.

### Yearly review report
A year-in-review report generated at the start of each new year,
covering the year just ended. Once the format is nailed down, also
generate retroactive reports for past years — so the format needs to
lean on data that exists historically (reads, reading_log, ratings,
acquisitions), not on anything only captured going forward. Design
the report first, then the generation trigger.

### Import / export
First-class library import/export for portability: a full export of
the library (books + reads + reading_log + tags + people + lists) in
a re-importable format (JSON and/or CSV), and the matching importer.
Distinct from the backup pipeline (raw DB files) and from the one-off
Amazon CSV scripts in `scripts/` — this is user-facing interop and
"get my data out" insurance.

### Duplicate / edition sweep as an Audit Wizard mode
The duplicate-cluster scan in CLAUDE.md (same title + author across
records) is "run periodically" with no trigger — a remembered chore.
Turn it into an Audit Wizard mode: surface candidate clusters, offer
work-link (alternate edition) or merge-and-delete (true duplicate)
per cluster, following the merge conventions in CLAUDE.md. Matching
must normalise leading articles ("Odyssey" vs "The Odyssey" split one
work across two work groups until the 2026-07-05 sweep).

### Client bundle code-splitting
Every build warns about a >500 kB main chunk (~619 kB minified).
Routes are already lazy; the win is carving vendor weight (recharts
is the likely bulk) out of the index chunk via manualChunks or
narrower imports. Pure cold-load perf — nothing user-visible beyond
first paint.

### Docker / docker-compose
Containerize Spine for a reliable "works on any box" install. Would
eliminate native-module build pain (better-sqlite3) and make setup
truly one-command. Keep the README in step when this lands. Note the
backup pipeline (cron + rclone on the host) needs a story too —
volume mounts for `spine.db`, `uploads/`, `backups/`.

### Density pass
The design direction is calm, dense, bookish, frictionless. A further
density tightening (smaller gaps/paddings across grids and detail
surfaces) is on the table wherever it doesn't compromise readability.
Motion-based affordances stay out. The cover-first grid recipe
(inset ring + dark hover tray, no labels at rest) is the pattern for
any new card surface.

## Done

### Author merge — shipped 1.259.0 (2026-07-05)
`POST /api/authors/:id/merge {other_id}` merges the duplicate into
:id: re-points `book_authors` + `story_authors` (dropping the loser's
row where both variants were bylined together), COALESCE-fills blank
metadata, ORs loved, inherits alias-group membership, deletes the
loser. Surface: "⇆ Merge a duplicate into this author" on the Author
page (search picker + confirm step). The Audit Wizard surface can
come with the duplicate/edition sweep mode, which should reuse this
endpoint.
