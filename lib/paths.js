import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Where uploaded covers and author portraits live — one definition for the
// server and the maintenance scripts (it used to be recomputed in seven
// places). Thumbs are derived max-400px JPGs beside each originals dir.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// SPINE_UPLOADS_DIR overrides the location. Under node --test (which marks
// its child processes with NODE_TEST_CONTEXT) a throwaway directory is used,
// removed when the process exits, and exported so subprocesses share it:
// tests save covers and portraits, and with the real uploads/ those
// fixtures were left in the library's folder — and from there in the
// nightly snapshots and the B2 mirror (188 fixture portraits by 2026-10-15).
function uploadsRoot() {
  if (process.env.SPINE_UPLOADS_DIR) return process.env.SPINE_UPLOADS_DIR;
  if (process.env.NODE_TEST_CONTEXT) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-test-uploads-'));
    process.env.SPINE_UPLOADS_DIR = dir;
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
    return dir;
  }
  return path.join(root, 'uploads');
}

export const UPLOADS_DIR       = uploadsRoot();
export const COVER_THUMBS_DIR  = path.join(UPLOADS_DIR, 'thumbs');
export const AUTHOR_PHOTOS_DIR = path.join(UPLOADS_DIR, 'authors');
export const AUTHOR_THUMBS_DIR = path.join(AUTHOR_PHOTOS_DIR, 'thumbs');

// Backups written by backup.sh / backup-hourly.sh / backup-transcripts.sh.
export const BACKUPS_DIR       = path.join(root, 'backups');
