#!/usr/bin/env bash
set -euo pipefail

SPINE_DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$SPINE_DIR/spine.db"
UPLOADS="$SPINE_DIR/uploads"
BACKUP_DIR="$SPINE_DIR/backups"
DAILY_DB_DIR="$BACKUP_DIR/daily-db"
KEEP=14
RCLONE_REMOTE="spine-b2:spine-backups"

SNAP_DIR="$BACKUP_DIR/uploads-snapshots"
mkdir -p "$BACKUP_DIR" "$DAILY_DB_DIR" "$SNAP_DIR"

STAMP="$(date +%Y-%m-%d)"
DEST_DB_DAILY="$DAILY_DB_DIR/spine-$STAMP.db"
DEST_SNAP="$SNAP_DIR/$STAMP"

# DB: a dated daily copy (sqlite3 .backup is safe under concurrent writes,
# plain cp is not). The B2 sync below mirrors this directory.
sqlite3 "$DB" ".backup '$DEST_DB_DAILY'"

# uploads/: a dated snapshot hard-linked against the previous day's
# (rsync --link-dest). Each snapshot is a complete, browsable copy, but a
# file unchanged since yesterday shares yesterday's inode, so a day costs
# only the covers / portraits added or changed. This replaced a nightly
# tarball of DB + uploads/ — ~2 GB a day, 95%+ identical day to day,
# 28 GB at 14 days. Restore: rsync -a --delete <snapshot>/ uploads/.
# Hard links mean a file rewritten IN PLACE changes in every snapshot that
# shares it; Spine gives new covers and portraits new filenames, and the
# only in-place writer is the thumb backfills' --force (derived data).
# Built under .partial and renamed, so a failed run never leaves a
# half-copied snapshot looking complete.
PREV="$(ls -1d "$SNAP_DIR"/* 2>/dev/null | grep -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}$' | grep -v "/$STAMP\$" | tail -n 1 || true)"
rsync -a --delete ${PREV:+--link-dest="$PREV"} "$UPLOADS/" "$DEST_SNAP.partial/"
rm -rf "$DEST_SNAP"
mv "$DEST_SNAP.partial" "$DEST_SNAP"
echo "Backed up DB to $DEST_DB_DAILY; uploads snapshot $DEST_SNAP (all snapshots: $(du -sh "$SNAP_DIR" | cut -f1))"

# Retain the most recent $KEEP uploads snapshots + DB copies; trim older.
{ ls -1d "$SNAP_DIR"/* 2>/dev/null | grep -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}$' || true; } | head -n -"$KEEP" | xargs -r rm -rf --
{ ls -1t "$DAILY_DB_DIR"/spine-*.db 2>/dev/null || true; } | tail -n +$((KEEP + 1)) | xargs -r rm --
# Legacy spine-YYYY-MM-DD.tar.gz files from before the snapshots age out.
find "$BACKUP_DIR" -maxdepth 1 -name 'spine-*.tar.gz' -mtime +"$KEEP" -delete

# Off-VM sync to B2 (Backblaze): the dated DB copies (~5 MB each) and a
# per-file mirror of uploads/. rclone sync is incremental: only new/changed files upload.
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
