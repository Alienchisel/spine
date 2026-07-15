#!/usr/bin/env bash
set -euo pipefail

SPINE_DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$SPINE_DIR/spine.db"
UPLOADS="$SPINE_DIR/uploads"
BACKUP_DIR="$SPINE_DIR/backups"
DAILY_DB_DIR="$BACKUP_DIR/daily-db"
KEEP=14
RCLONE_REMOTE="spine-b2:spine-backups"

mkdir -p "$BACKUP_DIR" "$DAILY_DB_DIR"

STAMP="$(date +%Y-%m-%d)"
DEST_TAR="$BACKUP_DIR/spine-$STAMP.tar.gz"
DEST_DB_DAILY="$DAILY_DB_DIR/spine-$STAMP.db"

# Snapshot the DB into a tempdir first so the tarball captures a consistent
# copy (sqlite3 .backup is safe under concurrent writes, plain cp is not).
# Also keep a dated daily-only copy in $DAILY_DB_DIR — that's what the B2
# sync below mirrors. Off-VM storage stays small because DB snapshots are
# ~3 MB each, whereas tarballs are ~1 GB and 95% redundant day-over-day
# (uploads/ dominates and barely changes).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sqlite3 "$DB" ".backup '$TMP/spine.db'"
cp "$TMP/spine.db" "$DEST_DB_DAILY"

tar -czf "$DEST_TAR" -C "$TMP" spine.db -C "$SPINE_DIR" uploads
SIZE="$(du -h "$DEST_TAR" | cut -f1)"
echo "Backed up to $DEST_TAR ($SIZE)"

# Retain the most recent $KEEP tarballs + DB snapshots; trim older.
ls -1t "$BACKUP_DIR"/spine-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
ls -1t "$DAILY_DB_DIR"/spine-*.db   2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

# Off-VM sync to B2 (Backblaze). We deliberately don't push the daily
# tarball — uploads/ dominates its size and is 95%+ redundant day-over-day.
# Instead push the dated DB snapshot (~3 MB) and a per-file mirror of
# uploads/. rclone sync is incremental: only new/changed files upload.
# Deleted-locally files become hidden in B2 and the bucket's lifecycle
# rule fully removes them after its retention window (configure in the
# Backblaze console), so accidental local deletions remain recoverable.
# Restore recipe: pull the desired spine-YYYY-MM-DD.db from b2:db/ and
# rclone sync b2:uploads/ to a fresh uploads/ — see CLAUDE.md recovery
# playbook.
if command -v rclone >/dev/null 2>&1; then
  rclone sync "$DAILY_DB_DIR" "$RCLONE_REMOTE/db"      --quiet
  # thumbs/ directories are derived data (max-400px JPGs regenerated
  # from the originals by writeThumbForCover / writeThumbForAuthorPhoto
  # on save, or in bulk via the two backfill scripts). Excluding both
  # the book-cover thumbs (uploads/thumbs/) and the author-photo thumbs
  # (uploads/authors/thumbs/) saves ~116 MB of B2 storage per sync-tick
  # and stays regenerable on restore — see CLAUDE.md recovery playbook
  # for the two-line regen invocation.
  rclone sync "$UPLOADS"      "$RCLONE_REMOTE/uploads" --quiet \
    --exclude 'thumbs/**' --exclude 'authors/thumbs/**'
  echo "B2 off-VM sync complete"
else
  echo "rclone not installed; skipping B2 off-VM sync"
fi

# Trim backup.log to its last 5000 lines (~6 months at the current
# nightly + hourly cadence). Truncate-and-overwrite via shell redirect
# rather than `mv` so cron's already-open stdout descriptor keeps
# pointing at the same inode — `mv` would unlink the old inode and any
# further script output would land in an orphaned file and be lost.
LOG="$BACKUP_DIR/backup.log"
if [ -f "$LOG" ]; then
  TMP_LOG="$(mktemp)"
  tail -n 5000 "$LOG" > "$TMP_LOG"
  cat "$TMP_LOG" > "$LOG"
  rm "$TMP_LOG"
fi
