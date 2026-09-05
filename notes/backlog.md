# Backlog

Feature-scale aspirations — the things too big for papercuts.md and
too slow-moving to keep in anyone's head. Items graduate out when they
ship; add context inline so a cold read is enough to start the work.

Papercuts (small frictions, one-liners) stay in `notes/papercuts.md`.

## Open

### Authentication in front of Spine
Spine has no auth of its own (single-user by design). It's reached from a
Windows PC and a phone through Slipway, which runs on the same VM and
proxies the public URL straight to localhost:3001 **with no login** — so
today anyone who learns that URL has full read/write over the whole
library. 1.283.0 bound Spine to loopback (HOST env, default 127.0.0.1),
which closes the *direct-port* bypass (nothing on the network can hit
3001 directly), but NOT this — Slipway reaches localhost regardless. The
login is the real gap; deferred by choice 2026-09-05.

Options, in recommended order:
1. **Basic Auth gate in Spine** — single credential from env
   (`SPINE_AUTH_USER` / `SPINE_AUTH_PASS`); auth off when unset so
   localhost dev stays frictionless. Middleware over everything (API,
   SPA, `/uploads`), constant-time compare, no new deps (~30 lines).
   Transparent to the browser SPA (native prompt, no client changes).
   Must also update `ingest.js` + the HTTP importer scripts to send the
   credential (the DB-direct scripts don't need it — audit which is
   which). ~30 lines + CLI plumbing.
2. **Cookie login page in Spine** — small form + signed session cookie.
   Nicer UX (real logout, no re-prompt) but more code/surface.
3. **Auth at Slipway** — keep Spine unauthenticated, gate in Slipway if
   it supports basic auth / allowlist / SSO. No CLI changes; depends on
   Slipway's feature set (unconfirmed).

**Hard prerequisite for 1 or 2:** confirm the connection is HTTPS
end-to-end (Slipway terminating TLS) before enabling any reusable
password — otherwise it crosses the wire in cleartext. Currently unknown
(check the URL scheme / padlock in the browser, or that Slipway has a
cert). If it's plain HTTP, get TLS in place first.

Lower-priority companion: no security-header middleware (helmet / CSP /
X-Frame-Options). Minor for a single-user app, but cheap to add whenever
auth lands.

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

### Client bundle code-splitting — shipped 1.262.0 (2026-07-06)
The >500 kB warning wasn't recharts (that was already isolated in the
lazy Stats chunk, misleadingly named `index-*.js` after
`Stats/index.jsx`); the entry bulk was react-markdown's
micromark/remark tree, pulled in eagerly via BookDetail. Fixes:
`components/Markdown.jsx` lazy-loads react-markdown (exports
`spineUrlTransform` for the spine-book: scheme; BookDetail, TodayCard,
ListDetail migrated), and `manualChunks` in vite.config.js pins
react/react-dom/scheduler/react-router/@tanstack into a cache-stable
`vendor` chunk (deliberately no node_modules catch-all — that would
drag lazy-only libs back onto the cold path). Entry went 619 kB →
254 kB app + 248 kB vendor; markdown stack (118 kB) loads on first
markdown render; warning cleared.

### Duplicate / edition sweep as an Audit Wizard mode — shipped 1.261.0 (2026-07-06)
`GET /api/books/duplicate-clusters` buckets books by article-stripped
title + author set and returns clusters not fully resolved into one
work group; `POST /api/books/:id/merge {other_id}` collapses a true
duplicate into the :id survivor (survivor-first field fill, join-table
union, reads move with exact-dup skip, reading-log same-day
aggregation, work-group inheritance, loser deleted). Surface: a
computed "Same-work duplicates are linked or merged" row under Library
mechanics on /audit, wanding into /audit/wizard/duplicates — one
cluster per card, Link as editions / two-click Merge with survivor
pick / Skip. The scan-recipe chore in CLAUDE.md is now a wizard visit.

### Author merge — shipped 1.259.0 (2026-07-05)
`POST /api/authors/:id/merge {other_id}` merges the duplicate into
:id: re-points `book_authors` + `story_authors` (dropping the loser's
row where both variants were bylined together), COALESCE-fills blank
metadata, ORs loved, inherits alias-group membership, deletes the
loser. Surface: "⇆ Merge a duplicate into this author" on the Author
page (search picker + confirm step). The Audit Wizard surface can
come with the duplicate/edition sweep mode, which should reuse this
endpoint.
