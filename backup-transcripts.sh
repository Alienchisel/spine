#!/usr/bin/env bash
# Snapshot the Claude Code conversation transcripts for this project.
# Transcripts proved decisive in recovering ~500 cascaded story records
# on 2026-05-09; this is the safety net that lets us recover from a similar
# incident if the .claude/projects/ directory itself is ever damaged.
#
# Cadence: weekly (transcripts are append-only, so daily snapshots would
# be wasteful — the same ~480 MB of historical content would be copied 30×
# in our daily-backup retention window).
# Retention: the newest archive only. Each archive holds every transcript
# still in ~/.claude/projects, so older ones were near-identical copies
# (~1.4 GB each). The transcripts themselves still live there, so this is
# purely a "what if that directory dies" defense — and if the new archive
# comes out noticeably smaller than the previous one (transcripts removed
# or the directory damaged), nothing is pruned, so the older, fuller
# archive survives until someone looks.

set -euo pipefail

SPINE_DIR="$(cd "$(dirname "$0")" && pwd)"
# Claude Code names each project dir after the repo's absolute path with
# every '/' turned into '-'. Derive it from SPINE_DIR so this works on any box.
TRANSCRIPT_DIR="$HOME/.claude/projects/$(printf '%s' "$SPINE_DIR" | tr / -)"
BACKUP_DIR="$SPINE_DIR/backups"
KEEP=1

if [ ! -d "$TRANSCRIPT_DIR" ]; then
  echo "Transcript dir not found: $TRANSCRIPT_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d)"
DEST="$BACKUP_DIR/transcripts-$STAMP.tar.gz"

# Pack only the .jsonl files. The session-scoped subdirectories under
# image-cache/ and tool-results/ are persistent-but-derivable from the
# transcripts themselves — skipping them keeps the snapshot lean.
# The directory name starts with '-' (it embeds the absolute path with
# slashes converted to dashes), so we need '--' to stop tar from parsing
# it as a flag. The active session's .jsonl may grow mid-read (this very
# script's invocation gets appended); suppress the resulting "file changed
# as we read it" warning — JSONL is append-only so the snapshot is still
# a valid prefix of the file. tar exits 1 in that case, which set -e would
# treat as fatal, so we explicitly tolerate exit 1 and re-throw exit 2.
set +e
tar -czf "$DEST" \
  -C "$(dirname "$TRANSCRIPT_DIR")" \
  --exclude='*/image-cache/*' \
  --exclude='*/tool-results/*' \
  --warning=no-file-changed \
  -- "$(basename "$TRANSCRIPT_DIR")"
TAR_RC=$?
set -e
if [ "$TAR_RC" -ne 0 ] && [ "$TAR_RC" -ne 1 ]; then
  echo "tar failed with exit code $TAR_RC" >&2
  exit "$TAR_RC"
fi

SIZE="$(du -h "$DEST" | cut -f1)"
echo "Backed up transcripts to $DEST ($SIZE)"

# Retain the most recent $KEEP snapshots — unless this one shrank by more
# than 10% against the newest older archive (see the header).
PREV="$({ ls -1t "$BACKUP_DIR"/transcripts-*.tar.gz 2>/dev/null || true; } | grep -vxF "$DEST" | head -n 1 || true)"
if [ -n "$PREV" ] && [ "$(stat -c %s "$DEST")" -lt $(( $(stat -c %s "$PREV") * 9 / 10 )) ]; then
  echo "WARNING: $DEST is >10% smaller than $PREV — transcripts may have been removed; keeping older archives" >&2
else
  { ls -1t "$BACKUP_DIR"/transcripts-*.tar.gz 2>/dev/null || true; } | tail -n +$((KEEP + 1)) | xargs -r rm --
fi
