#!/usr/bin/env bash
# Rolling hourly DB-only snapshot. Covers the threat class that B+C
# (pre/post migration safeguards) and the daily tarball don't:
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
DEST="$HOURLY_DIR/spine-$STAMP.db"

# Use sqlite3 .backup — handles WAL state correctly under concurrent
# writes, unlike plain cp.
sqlite3 "$DB" ".backup '$DEST'"
SIZE="$(du -h "$DEST" | cut -f1)"
echo "Hourly snapshot: $DEST ($SIZE)"

# Trim anything older than the retention window.
find "$HOURLY_DIR" -name 'spine-*.db' -mmin +"$RETAIN_MINUTES" -delete
