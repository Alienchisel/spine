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

_(nothing yet)_
