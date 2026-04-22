#!/usr/bin/env bash
set -euo pipefail

SPINE_DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$SPINE_DIR/spine.db"
BACKUP_DIR="$SPINE_DIR/backups"
KEEP=30

mkdir -p "$BACKUP_DIR"

DEST="$BACKUP_DIR/spine-$(date +%Y-%m-%d).db"
sqlite3 "$DB" ".backup '$DEST'"
echo "Backed up to $DEST"

# Remove backups beyond the most recent $KEEP
ls -1t "$BACKUP_DIR"/spine-*.db | tail -n +$((KEEP + 1)) | xargs -r rm --
