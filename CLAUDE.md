# Spine — operational notes

This file documents non-obvious infrastructure for anyone (or any future
assistant) maintaining Spine. Codebase conventions belong elsewhere; this
is just operations.

## Backup pipeline

Three cron-driven scripts under repo root, all logging to `backups/backup.log`:

| Script | Cadence | Retention | What it captures |
|---|---|---|---|
| `backup.sh` | daily, 00:00 | 30 days | full DB (`sqlite3 .backup`) + `uploads/` directory, as one tarball |
| `backup-hourly.sh` | hourly, :00 | 48 h | DB only (`sqlite3 .backup`), files prefixed `hourly-spine-` so they don't collide with any `spine-*.db` glob |
| `backup-transcripts.sh` | weekly, Sun 00:30 | 3 weeks | `~/.claude/projects/.../*.jsonl` — Claude Code transcripts that proved decisive in the 2026-05-09 recovery |

Cron entries live in the user's crontab. If a contributor sets up a
new dev machine, those need re-adding manually:

```
0 0 * * *  /path/to/spine/backup.sh             >> .../backups/backup.log 2>&1
0 * * * *  /path/to/spine/backup-hourly.sh      >> .../backups/backup.log 2>&1
30 0 * * 0 /path/to/spine/backup-transcripts.sh >> .../backups/backup.log 2>&1
```

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
