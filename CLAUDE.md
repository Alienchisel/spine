# Spine — operational notes

This file documents non-obvious infrastructure for anyone (or any future
assistant) maintaining Spine. Codebase conventions belong elsewhere; this
is just operations.

## Backup pipeline

Three cron-driven scripts under repo root, all logging to `backups/backup.log`.
`backup.sh` self-trims the log to its last 5000 lines at the end of every
nightly run (truncate-and-overwrite, not `mv` — preserves cron's open fd).

| Script | Cadence | Retention | What it captures |
|---|---|---|---|
| `backup.sh` | daily, 00:00 | 30 days | full DB + `uploads/` as a tarball (local); plus a dated DB-only snapshot in `backups/daily-db/` (mirrored to B2) |
| `backup-hourly.sh` | hourly, :05 | 48 h | DB only (`sqlite3 .backup`), files prefixed `hourly-spine-` so they don't collide with any `spine-*.db` glob |
| `backup-transcripts.sh` | weekly, Sun 00:30 | 3 weeks | `~/.claude/projects/.../*.jsonl` — Claude Code transcripts that proved decisive in the 2026-05-09 recovery |

### Off-VM sync (Backblaze B2)

`backup.sh` ends with an `rclone sync` to the B2 bucket via the
`spine-b2:` remote (configured locally via `rclone config`, see
`~/.rclone.conf`). It pushes two things:

- `backups/daily-db/` → `spine-b2:spine-backups/db/` — one ~3 MB DB
  snapshot per day, mirroring the local 30-day retention.
- `uploads/` → `spine-b2:spine-backups/uploads/` — per-file incremental
  mirror. Only changed/added files upload each night. `uploads/thumbs/`
  is excluded via `--exclude 'thumbs/**'`: those are max-400 px JPGs
  regenerated from originals on save (via `writeThumbForCover` in
  `lib/books/covers.js`) or in bulk via `scripts/backfill-cover-thumbs.js`,
  so shipping them off-VM would only waste ~112 MB of B2 storage without
  buying any state we can't reproduce locally in ~2 minutes.

The **daily tarballs are not pushed**. They're ~1 GB each and 95%+
redundant day-over-day (uploads/ dominates and barely changes); pushing
them would balloon B2 storage by ~30 GB without buying any recoverable
state we don't already have from the DB-snapshot + uploads-mirror pair.
The tarballs stay local for fast atomic-snapshot recovery within the VM.

**Bucket setup:**

- Bucket name: `spine-backups` (Backblaze account)
- Region: **CA-East** (Montreal — data stays on Canadian soil; lower
  latency than US-East for the VM at the cost of being a slightly
  newer region than US-West)
- Encryption: SSE-B2 (server-managed, free)
- Visibility: Private
- Object Lock: off
- Lifecycle rule: **30 days** from hide → delete. Set in the
  Backblaze console → bucket settings → Lifecycle. Without this,
  hidden versions accumulate indefinitely; with it, B2 storage stays
  bounded at "current local mirror + ~30 days of deleted-file safety
  net."

**Cost / free tier:** B2 Cloud Storage gives 10 GB storage and 1 GB/day
download free permanently. Current steady-state footprint is ~1.5–2 GB
(DB snapshots ~90 MB + uploads/ mirror ~1.3 GB + lifecycle-retained
hidden versions). Well under the free ceiling; if the library grows
past ~8 GB of uploads we'll cross into paid territory (~$0.005/GB/mo
on top of the 10 GB free).

**Verification (confirmed 2026-06-20):** daily DB snapshots land in B2
at `00:00:01` consistently. Quick health check:

```bash
rclone lsl --max-age 7d spine-b2:spine-backups/db/ | sort -k 2
rclone size spine-b2:spine-backups
```

The first should print one row per day for the last week with
monotonically growing sizes; the second should be well under 10 GB.
A missing day means the previous night's `backup.sh` failed before the
`rclone sync` step — check `backups/backup.log` for the error.

**Fresh-VM rclone setup recipe:**

```bash
sudo apt install rclone
rclone config
# n (new remote) → name "spine-b2" → storage type "b2"
# account: <keyID — the 25-char hex one starting with 005/006>
# key:     <applicationKey — the K-prefixed ~31-char base64-ish one>
# endpoint: <blank — auto-detected from keyID>
# advanced: n   keep remote: y   quit: q
rclone lsd spine-b2:spine-backups   # sanity check, should auth & list
```

Key pair lives in 1Password (or your password manager of choice). They
are *not* in this repo. The applicationKey is shown exactly once at
creation — if you lose it, you have to rotate.

**Restoring from B2 in a total-VM-loss scenario:**

```bash
git clone git@github.com:Alienchisel/spine.git
cd spine
# Pull the DB snapshot for the day you want to restore to
rclone copy spine-b2:spine-backups/db/spine-2026-MM-DD.db ./spine.db
# Mirror the covers/photos (thumbs are excluded from B2 — regenerated below)
rclone sync spine-b2:spine-backups/uploads ./uploads
npm run setup
# Regenerate the /uploads/thumbs/ companions that BookCard grids serve.
# Skipped in the B2 sync because they're derived data (~112 MB) — regen
# takes ~2 min on the current library and is idempotent.
./scripts/with-toolchain.sh node scripts/backfill-cover-thumbs.js
npm start
```

**Key rotation:**

Rotate the rclone application key annually, and immediately if it's
ever exposed (pasted to chat, written to a non-encrypted note,
suspected breach). The procedure:

1. Backblaze console → Application Keys → "Add a New Application Key"
   with the same restrictions (bucket: `spine-backups`, Read+Write,
   no list-all).
2. `rclone config` → `e` → `spine-b2` → paste the new keyID/applicationKey.
3. Test: `rclone lsd spine-b2:spine-backups`.
4. Delete the old key in the Backblaze console.

To inspect the config without exposing the live secret (e.g. when
sharing logs):

```bash
rclone config show spine-b2 | sed 's/^key.*/key = [REDACTED]/'
```

Cron entries live in the user's crontab. If a contributor sets up a
new dev machine, those need re-adding manually:

```
0 0 * * *  /path/to/spine/backup.sh             >> .../backups/backup.log 2>&1
5 * * * *  /path/to/spine/backup-hourly.sh      >> .../backups/backup.log 2>&1
30 0 * * 0 /path/to/spine/backup-transcripts.sh >> .../backups/backup.log 2>&1
```

The hourly fires at `:05` rather than `:00` so it doesn't race the daily
backup at midnight — both invoke `sqlite3 .backup` and the daily then
tarballs `uploads/` (slow). Staggering by 5 minutes keeps them from
contending for the SQLite write lock and disk.

## Migration runner safeguards

`lib/migrations/runner.js` orchestrates the migration loop. For every
pending migration it:

1. **Snapshots the DB** before applying via `VACUUM INTO`, named
   `backups/spine-pre-<migration>-<ts>.db`. Pruned after 90 days.
2. **Applies the migration** through `applyMigration.js`, which gates
   on `PRAGMA foreign_keys = OFF` (or `0` / `false`) and bypasses the
   wrapping transaction for those — SQLite silently ignores the PRAGMA
   inside an open transaction, so a table-rebuild migration would
   otherwise cascade through every junction table.
3. After the batch, **diffs row counts** against the pre-batch
   snapshot. If any non-empty table dropped to 0 rows AND the table
   still exists post-migration, throws — the server refuses to start
   on a wrecked DB. Tables that no longer exist are skipped (legit
   rename or drop).

Regression tests live in `test/migrations.test.js`. The 2026-05-09
cascade is the originating incident; its migration (`053_relax_books_rating_check.sql`)
is the canonical example of why the safeguards exist.

## Writing migrations

File naming: `NNN_<short_description>.sql`, sequential. The name appears
in the pre-snapshot filename and any failure error message — keep it
descriptive.

- **Additive changes** (`ALTER TABLE … ADD COLUMN`, new tables, new
  indexes): just write the SQL. The runner wraps each in a transaction;
  any failure rolls back cleanly.
- **Table rebuilds** (relaxing a CHECK, dropping a column, etc.): start
  the migration with `PRAGMA foreign_keys = OFF;`. The runner detects
  this and bypasses the txn wrapper so the PRAGMA actually takes
  effect. Without it, `DROP TABLE old` cascades through every junction
  table whose FK referenced it — the 2026-05-09 incident.
- **Never `DELETE FROM` a non-empty user table.** The post-batch sanity
  check throws on non-empty → 0 transitions and refuses startup. If
  the wipe is intentional, `DROP TABLE` it instead — the check skips
  tables that no longer exist post-batch.
- **Test on a copy before merging.** `cp spine.db /tmp/test.db && DB_PATH=/tmp/test.db npm run dev:server`
  exercises the runner against your migration without touching the
  live DB.
- **Keep migrations short and reversible-in-spirit.** If a migration
  needs more than a few statements, write the rollback path as a
  comment at the top of the file — even if the runner won't auto-roll-back,
  you'll be glad of the recipe later.

## Recovery playbook

If you suspect data loss:

1. **Look at startup logs.** A failed sanity check throws with an
   error message that includes the path of the relevant pre-snapshot.
2. **Check `backups/`** — daily tarballs cover up to 30 days, hourly
   snapshots cover up to 48 hours, pre-migration snapshots cover the
   exact pre-state of any migration applied in the last 90 days.
3. **The transcripts** at `~/.claude/projects/-home-pentestlich-scripts-spine/*.jsonl`
   record every Claude-driven write. If the loss involved tool-driven
   ingests (like the May 9 story populations), the transcripts contain
   the original input and can be replayed. Earlier transcript snapshots
   are in `backups/transcripts-*.tar.gz`.
4. For SQLite forensic recovery from freed pages, `sqlite3 backup.db ".recover"`
   pulls orphan records into a `lost_and_found` table — useful when
   pages haven't been overwritten yet by subsequent activity.

The 2026-05-10 conversation transcript (in the JSONL files) walks
through a complete cascade-and-recover for reference.

### Restoring from a snapshot

Concrete commands. The dance is: stop the server (releases the WAL
connection), drop the WAL/SHM files (they're bound to the old DB and
will confuse SQLite if left next to the replacement), swap the file,
restart, verify.

```bash
cd /home/pentestlich/scripts/spine

# 1. Stop whatever is holding the DB. The dev stack is launched via
#    `concurrently npm run dev:server npm run dev:client` — kill the
#    server watcher; vite can keep running.
pkill -f 'node --watch server.js'

# 2. Move the broken DB aside (don't delete — wrong snapshot can leave
#    you worse off, and the broken state may have data the snapshot
#    lacks). Drop the WAL/SHM since they describe the old DB.
mv spine.db spine.db.broken-$(date +%s)
rm -f spine.db-wal spine.db-shm

# 3a. Restore from a pre-migration snapshot (the most precise option):
cp backups/spine-pre-053_relax_books_rating_check-<ts>.db spine.db

# 3b. OR restore from a daily tarball:
tar -xzf backups/spine-2026-05-09.tar.gz -C /tmp/ spine.db
mv /tmp/spine.db .

# 3c. OR restore from an hourly snapshot (last 48h):
cp backups/hourly/hourly-spine-2026-05-09-15.db spine.db

# 4. Restart and verify.
./scripts/with-toolchain.sh node --watch server.js >> /tmp/spine-server.log 2>&1 &
sleep 2
curl -s 'http://localhost:3001/api/books?limit=1' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('total:', d.get('total'))"
```

If the restored DB is missing recent activity (e.g. you restored to
yesterday but want today's reading sessions back), the transcripts
typically have the original tool-driven writes — see step 3 of the
playbook above.

## Live-data maintenance

Notes on the live-data model that come up regularly during ingest /
audit work and aren't obvious from the schema alone.

### Shelf hierarchy

Physical-book location is a four-level tree: **building → room → unit
→ shelf**. A book row stores `building_id`, `room_id`, `unit_id`, and
`shelf_id` columns, but *exactly one* is set — the most specific
granularity the user chose — and the others are null. The
normalisation runs through `normalizeBookLocation` in
`lib/books/normalization.js`; callers send any subset and the
repository writes only the most specific id.

The single source for the whole layout is `GET /api/shelf/tree`,
mounted at `app.use('/api/shelf', shelfRouter)` (see
`routes/shelf.js`). To find a unit/shelf id from a human name:

```bash
curl -s 'http://localhost:3001/api/shelf/tree' | python3 -c "
import json, sys
def walk(node, depth=0):
    if isinstance(node, list):
        for n in node: walk(n, depth); return
    name = node.get('name') or node.get('label') or '?'
    print('  ' * depth + f'{name} (id={node.get(\"id\")})')
    for k in ('rooms','units','shelves'):
        for c in node.get(k, []) or []: walk(c, depth+1)
walk(json.load(sys.stdin))" | grep -i 'grey 5'
# → 'Grey 5 (id=14)' — that's a unit_id, not a shelf_id.
```

Naming gotcha: shelf-level labels are typically `1st / 2nd / 3rd /
...` *under* a named unit, and units themselves often have names like
"Paperback Tower 2" or "Grey 5" that *look* like shelf labels. When
the user says **"Grey 5"** they mean `unit_id=14`, not a shelf inside
unit Grey. Confirm against `/api/shelf/tree` before assuming
otherwise.

### Edition groups (`work_id`)

Two book records that are alternate editions of the same underlying
work share a non-null `work_id`. The relationship is **symmetric**
(every member sees every other on its BookDetail page) and
**transitive** (linking a new edition into an existing group joins
them all; linking two existing groups merges them into the
lower-id group).

API:

```
POST   /api/books/:id/work-link   { "other_id": <N> }
DELETE /api/books/:id/work-link    # removes :id from its group
```

Use this whenever you intentionally keep a duplicate edition (a
different translation, a hardcover + paperback pair, a French original
+ English translation, an audiobook + physical, etc.). Quick scan for
unlinked clusters (same title + same author, differing publisher OR
format, at least one with null `work_id`):

```sql
SELECT b.id, b.title, b.publisher, b.format, b.work_id,
       (SELECT GROUP_CONCAT(a.name, ' & ') FROM book_authors ba
          JOIN authors a ON a.id=ba.author_id WHERE ba.book_id=b.id
          ORDER BY ba.position) AS authors
FROM books b WHERE b.archived = 0
ORDER BY lower(b.title), b.id;
```

Group rows in app code, link via the API. **Normalise leading
articles when clustering** — strip `^(the|a|an)\s+` from the lowered
title before grouping. "Odyssey" vs "The Odyssey" evaded the
exact-title match and left the same work split across two work groups
until the 2026-07-05 sweep caught it.

Sweep performed 2026-06-20 brought the linkage count from 7 groups to
64; subsequent ingests should keep editions linked at the moment of
ingest rather than collecting another backlog.

The sweep is automated as of 1.261.0: `GET /api/books/duplicate-clusters`
returns the unresolved clusters (article-normalised title + author
bucketing; clusters whose members all share one non-null `work_id`
count as resolved), the Audit page surfaces the count as "Same-work
duplicates are linked or merged", and `/audit/wizard/duplicates`
offers Link-as-editions / Merge / Skip per cluster. The SQL recipe
above stays useful for ad-hoc variants of the scan.

### Merging duplicate book records

When a duplicate record is not an alternate edition but a true
duplicate (same physical book ingested twice, identical title +
publisher + year + format and no distinguishing field), merge rather
than link. As of 1.261.0 there's a dedicated endpoint —
`POST /api/books/:id/merge {other_id}` merges the loser (`other_id`)
into the `:id` survivor in one transaction: survivor-first field fill,
join-table union, reads moved with exact-duplicate skip, reading-log
same-day aggregation, work-group inheritance, loser deleted. The
duplicates wizard drives it in-app. The manual pattern below remains
the reference for what "merge" means (and for partial/custom merges):

1. **Inspect both records for unique fields.** The columns most
   likely to differ in a real-vs-phantom split are
   `acquisition_source`, `acquisition_date`, `read_count`, `rating`,
   `review`, `description`, `notes`, `unit_id` / `shelf_id`,
   `isbn_10` / `isbn_13`, and the joined `tags` array. A quick
   sqlite3 diff or two `GET /api/books/:id` calls covers it.
2. **Pick the survivor** — usually the lower id (older record,
   more likely to carry acquisition history), but choose by data
   richness when a later record has accumulated more.
3. **PATCH the survivor** with any fields the loser had and the
   survivor didn't. The `PATCH /api/books/:id` endpoint accepts any
   subset of the column schema; the join-table fields (`tags`,
   `authors`, `narrators`, `translators`) replace fully, so send the
   *merged* list, not a delta.
4. **DELETE the loser** via `DELETE /api/books/:id`. The work-link
   API auto-merges work groups if both members were already linked
   into different groups.

Precedent runs:

- **2026-06-20 Saul merge.** `Voltaire's Bastards` #93 (Penguin 1993,
  shelved Grey 5) survived; #2015 (Penguin Canada 1992, Grey 3) was
  PATCHed into #93's record for its better description and the four
  tags it carried, then deleted.
- **2026-06-20 Letters trio cleanup.** Three identical records each
  for McLuhan / Wyndham Lewis / Burroughs Letters were ingestion
  duplicates of a single physical copy. Kept the lowest-id record in
  each set; deleted the other two. Plotinus Enneads (#1067 +
  #2365) was flagged for the user to verify before deletion —
  reserve this for genuinely ambiguous cases.

The duplicates wizard (`/audit/wizard/duplicates`) surfaces edition
candidates and ingestion duplicates alike — the audit row's count is
the standing trigger that used to be a "run the scan periodically"
chore.
