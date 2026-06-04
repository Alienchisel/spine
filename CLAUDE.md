# Spine — operational notes

This file documents non-obvious infrastructure for anyone (or any future
assistant) maintaining Spine. Codebase conventions belong elsewhere; this
is just operations.

## Backup pipeline

Three cron-driven scripts under repo root, all logging to `backups/backup.log`:

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
  mirror. Only changed/added files upload each night.

The **daily tarballs are not pushed**. They're ~1 GB each and 95%+
redundant day-over-day (uploads/ dominates and barely changes); pushing
them would balloon B2 storage by ~30 GB without buying any recoverable
state we don't already have from the DB-snapshot + uploads-mirror pair.
The tarballs stay local for fast atomic-snapshot recovery within the VM.

Configure a B2 bucket **lifecycle rule** (Backblaze console → bucket
settings → Lifecycle) to "delete hidden files after N days" — pick a
window (e.g. 30 days) that matches your desired off-VM recovery horizon
for accidentally-deleted covers. Without it, hidden versions accumulate
indefinitely and B2 storage grows monotonically.

Restoring from B2 in a total-VM-loss scenario:

```bash
git clone git@github.com:Alienchisel/spine.git
cd spine
# Pull the DB snapshot for the day you want to restore to
rclone copy spine-b2:spine-backups/db/spine-2026-MM-DD.db ./spine.db
# Mirror the covers/photos
rclone sync spine-b2:spine-backups/uploads ./uploads
npm run setup && npm start
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
