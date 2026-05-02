#!/usr/bin/env bash
set -euo pipefail

SPINE_DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$SPINE_DIR/spine.db"
UPLOADS="$SPINE_DIR/uploads"
BACKUP_DIR="$SPINE_DIR/backups"
KEEP=30

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d)"
DEST="$BACKUP_DIR/spine-$STAMP.tar.gz"

# Snapshot the DB into a tempdir first so the tarball captures a consistent
# copy (sqlite3 .backup is safe under concurrent writes, plain cp is not).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sqlite3 "$DB" ".backup '$TMP/spine.db'"

tar -czf "$DEST" -C "$TMP" spine.db -C "$SPINE_DIR" uploads
SIZE="$(du -h "$DEST" | cut -f1)"
echo "Backed up to $DEST ($SIZE)"

# Retain the most recent $KEEP tarballs; trim older.
ls -1t "$BACKUP_DIR"/spine-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
