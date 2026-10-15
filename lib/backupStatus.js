import fs from 'fs';
import path from 'path';
import { BACKUPS_DIR } from './paths.js';

// When did the nightly backup (backup.sh) last finish? backup.sh writes an
// ISO timestamp to backups/last-success only after every step — DB copy,
// uploads snapshot, B2 sync — has succeeded, so a night that failed
// partway leaves the previous timestamp. The Audit page shows it and
// warns once it is older than a day plus slack: a disk-full failure on
// 2026-06-04 went unnoticed because it only ever reached backup.log.
// null when there is no marker at all (a dev or test machine where the
// cron jobs were never set up), so nothing is shown there.
export const BACKUP_STALE_HOURS = 26;

export function getBackupStatus(dir = BACKUPS_DIR, now = Date.now()) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, 'last-success'), 'utf8').trim();
  } catch {
    return null;
  }
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return { lastSuccess: null, stale: true };
  return { lastSuccess: new Date(at).toISOString(), stale: now - at > BACKUP_STALE_HOURS * 3600 * 1000 };
}
