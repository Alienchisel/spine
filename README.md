# Spine

A personal library manager. Track your books, reading progress, shelves, diary entries, lists, and stats.

## Requirements

- Node.js 18 or later
- npm

## Setup

```bash
npm run setup
npm start
```

The app runs at [http://localhost:3001](http://localhost:3001). The database and uploads directory are created automatically on first run.

`npm run setup` installs all dependencies and builds the frontend in one step.

## Development

Run the server and client dev servers concurrently with hot reload:

```bash
npm run dev
```

The client dev server proxies API requests to `localhost:3001`.

### Verifying changes

Before committing, run:

```bash
npm run check
```

This runs the test suite, the client lint, and then the production build. The
stages catch different things — `npm test` exercises the server / DB / API;
`npm run lint` catches client code issues; `npm run build` compiles the client
and surfaces broken imports or syntax errors that tests don't see.
Individually:

```bash
npm test        # server-side suite only
npm run lint    # client lint only
npm run build   # production client build only
```

For render-time crashes that none of those stages can see (a route that
builds cleanly but dies in the browser), run the headless route smoke test
with the dev stack up:

```bash
scripts/smoke-routes.sh
```

It loads every client route in headless Chromium and fails if any of them
renders the error boundary or comes back empty. Point it at a production
instance with `SPINE_CLIENT_URL=http://localhost:3001 scripts/smoke-routes.sh`.

## Ingester

Add books by Amazon URL or ISBN from the command line:

```bash
node ingest.js 9780465038565
node ingest.js https://www.amazon.com/dp/0465038565
```

By default the ingester posts to `http://localhost:3001`. Override with:

```bash
SPINE_URL=http://your-host:3001 node ingest.js <isbn>
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `DB_PATH` | `./spine.db` | Path to the SQLite database file |

## Importers

Scripts in `scripts/` import Amazon/Audible "Request my data" CSV exports into Spine. Each one runs in dry-run mode by default; pass `--apply` to actually write.

### Audible listening → diary

```bash
node scripts/import-audible-listening.js path/to/Listening.csv
node scripts/import-audible-listening.js path/to/Listening.csv --apply
node scripts/import-audible-listening.js path/to/Listening.csv --apply --min-event-seconds=60
```

Groups events by (ASIN, date), sums `Event Duration Milliseconds` to per-day minutes, and upserts into `reading_log` (the table that powers the Diary). Books are matched by ASIN; `--min-event-seconds` (default 60) drops sub-threshold accidental plays.

### Repair audiobook ASINs from listening data

```bash
node scripts/repair-asins-from-listening.js path/to/Listening.csv
node scripts/repair-asins-from-listening.js path/to/Listening.csv --apply
```

Matches CSV products to Spine audiobooks by normalised title, then either fills missing ASINs or replaces existing ones with the CSV's authoritative value. Reports ambiguous matches and unmatched products as a punch-list.

### Estimate finish dates from listening data

```bash
node scripts/estimate-finish-dates-from-listening.js path/to/Listening.csv
node scripts/estimate-finish-dates-from-listening.js path/to/Listening.csv --apply
```

Walks per-ASIN listening events chronologically, detects completions (End Position ≥ 95% of Book Length) and re-reads (position resets back to ≤ 5% with at least 7 days gap since the last completion). Backfills `books.date_started`, `books.date_finished`, `books.read_count`, `books.status`, and inserts `reads` rows — only fills, never overwrites manually-entered dates.

### Kindle reading sessions → diary

```bash
node scripts/import-kindle-reading-sessions.js path/to/Reading-Sessions.csv
node scripts/import-kindle-reading-sessions.js path/to/Reading-Sessions.csv --apply
node scripts/import-kindle-reading-sessions.js path/to/Reading-Sessions.csv --apply --asin=B075MRHZBV
```

Kindle parallel to the Audible listening importer. Groups CSV rows by (ASIN, date), sums `total_reading_millis` to per-day minutes, and upserts into `reading_log` using the same idempotent shape so re-runs are safe. Books are matched by ASIN; filter to specific titles with `--asin=<id>[,...]` or `--book-id=<n>[,...]`. Short sessions are dropped via `--min-event-seconds` (default 60); pass `--include-page-flips` to keep them.

## Maintenance

### De-dupe authors, narrators, translators, publishers

```bash
node scripts/dedupe.js scan-authors          # also scan-narrators, scan-translators, scan-publishers
node scripts/dedupe.js merge-author <keep_id> <drop_id>
node scripts/dedupe.js rename-publisher "<old>" "<new>"
```

Scans group rows under a relaxed normalisation (lowercased, diacritics
stripped, name particles like "de"/"von" removed for people, imprint suffixes
like "Press"/"Publishing" stripped for publishers) and print candidate
clusters. Merge and rename actions take exact IDs / strings, prompt for
confirmation (skip with `--yes`), and snapshot the database to
`backups/spine-pre-dedup-<label>-<ts>.db` before writing anything.

## Backfill scripts

One-off and re-runnable scripts that don't follow the CSV-import shape:

### Fill SF author dates from ISFDB

```bash
node scripts/fill-sf-dates-from-isfdb.js
node scripts/fill-sf-dates-from-isfdb.js --apply
```

For every author tagged as Science Fiction with no `birth_date`, searches ISFDB by exact name, parses Birthdate / Deathdate, and PATCHes into Spine. The PATCH is the existing non-destructive merge — already-set values are preserved. 800ms polite delay between requests. Re-runnable as the SF corpus grows.

### Strip date parentheticals from author bios

```bash
node scripts/strip-bio-dates.js
node scripts/strip-bio-dates.js --apply
```

Strips the leading "(1920–1992)"-style parenthetical from every `authors.bio` row, using the same helper that now cleans incoming Open Library fetches — keeps the existing rows and future fetches in the same shape.

## Troubleshooting

`better-sqlite3` is a native module that compiles against your local Node/OS during `npm install`. If the setup fails, make sure you have the required build tools:

**Linux (Debian/Ubuntu):**
```bash
sudo apt install python3 make g++
```

**macOS:**
```bash
xcode-select --install
```

**Windows:** Install the [Windows Build Tools](https://github.com/nodejs/node-gyp#on-windows) via node-gyp's instructions.

## Data

- **Database**: `spine.db` (SQLite, created automatically)
- **Covers**: `uploads/` (created automatically)
- **Backups**: three cron-driven scripts write to `backups/` — `backup.sh` (nightly full tarball + DB snapshot, synced off-site to Backblaze B2), `backup-hourly.sh` (48 h of hourly DB snapshots), and `backup-transcripts.sh` (weekly). Operational detail, including restore procedures, lives in `CLAUDE.md`.
