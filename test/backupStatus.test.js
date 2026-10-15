import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getBackupStatus, BACKUP_STALE_HOURS } from '../lib/backupStatus.js';
import { UPLOADS_DIR } from '../lib/paths.js';

describe('backup status (Audit page line)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-backup-status-'));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-nobackup-'));
  after(() => { for (const d of [dir, empty]) fs.rmSync(d, { recursive: true, force: true }); });
  const write = (v) => fs.writeFileSync(path.join(dir, 'last-success'), v);
  const at = Date.parse('2026-10-15T00:00:05-04:00');

  it('is null where backups were never set up', () => {
    assert.equal(getBackupStatus(empty), null);
  });

  it('is fresh within a day plus slack, stale after', () => {
    write('2026-10-15T00:00:05-04:00\n');
    assert.equal(getBackupStatus(dir, at + 20 * 3600 * 1000).stale, false);
    assert.equal(getBackupStatus(dir, at + (BACKUP_STALE_HOURS + 1) * 3600 * 1000).stale, true);
    assert.equal(getBackupStatus(dir, at).lastSuccess, new Date(at).toISOString());
  });

  it('treats an unreadable marker as stale', () => {
    write('garbage');
    assert.deepEqual(getBackupStatus(dir, at), { lastSuccess: null, stale: true });
  });
});

describe('test runs keep uploads out of the real folder', () => {
  // Regression: author-photo tests wrote fixture portraits into the
  // library's uploads/ (and on into the nightly snapshots and B2).
  it('UPLOADS_DIR is a throwaway directory under the test runner', () => {
    const real = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'uploads');
    assert.notEqual(path.resolve(UPLOADS_DIR), real);
    assert.ok(UPLOADS_DIR.startsWith(os.tmpdir()));
  });
});
