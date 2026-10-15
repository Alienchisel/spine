#!/usr/bin/env bash
# Rolling hourly DB-only snapshot. Covers the threat class that the
# pre/post migration safeguards and the daily copy don't:
# user-initiated mistakes and Spine code regressions that aren't
# triggered by a migration. Sliding 48h window — enough to span a
# weekend's "I noticed Monday what I did Friday."
#
# DB-only (no uploads, no transcripts) keeps the snapshot tiny
# (~2 MB) and the rotation negligible (~96 MB steady state).

set -euo pipefail

SPINE_DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$SPINE_DIR/spine.db"
HOURLY_DIR="$SPINE_DIR/backups/hourly"
RETAIN_MINUTES=2880  # 48 hours

mkdir -p "$HOURLY_DIR"

STAMP="$(date +%Y-%m-%d-%H)"
# Filename prefixed with `hourly-` so it doesn't collide with any
# `spine-*.db` glob a future cleanup script might run against the
# backup tree.
DEST="$HOURLY_DIR/hourly-spine-$STAMP.db"

# Use sqlite3 .backup — handles WAL state correctly under concurrent
# writes, unlike plain cp. Written to .tmp and renamed once complete, so a
# failed run (disk full, 2026-06-04) can't leave a truncated file that
# looks like a valid snapshot; switched out of WAL mode so reading it
# later doesn't leave -wal/-shm files behind.
sqlite3 "$DB" ".backup '$DEST.tmp'"
sqlite3 "$DEST.tmp" "PRAGMA journal_mode=DELETE;" > /dev/null
mv -f "$DEST.tmp" "$DEST"
SIZE="$(du -h "$DEST" | cut -f1)"
echo "Hourly snapshot: $DEST ($SIZE)"

# Trim anything older than the retention window.
find "$HOURLY_DIR" -name 'hourly-spine-*.db' -mmin +"$RETAIN_MINUTES" -delete
# Side files of copies read while still in WAL mode, and .tmp files left by
# a failed run.
find "$HOURLY_DIR" \( -name 'hourly-spine-*.db-wal' -o -name 'hourly-spine-*.db-shm' -o -name 'hourly-spine-*.db.tmp' \) -mmin +"$RETAIN_MINUTES" -delete
