// Own file (own process): needs a real on-disk database so a SECOND
// connection — standing in for an import script — can write to it.
// (:memory: databases aren't shared between connections.)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-dv-'));
const file = path.join(dir, 'dv.db');
process.env.DB_PATH = file;
const { getDataVersion, bumpDataVersion } = await import('../lib/dataVersion.js');

describe('data version', () => {
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('changes when another connection (a script) commits', () => {
    // Regression: scripts write through their own connection, so the
    // HTTP-only counter never moved and other devices kept stale data.
    const before = getDataVersion();
    const script = new Database(file);
    script.prepare("INSERT INTO settings (key, value) VALUES ('dv-test', '1')").run();
    script.close();
    assert.notEqual(getDataVersion(), before);
  });

  it('is stable when nothing changed, and still moves on API writes', () => {
    const a = getDataVersion();
    assert.equal(getDataVersion(), a);
    bumpDataVersion();
    assert.notEqual(getDataVersion(), a);
  });
});
