// The data-version beacon (lib/dataVersion.js + the bump middleware in
// app.js) is what lets a device detect writes made from ANOTHER device
// — the client checks GET /api/version on tab focus and invalidates its
// TanStack Query cache only when the version moved. These tests pin the
// bump semantics: successful mutations bump, failed mutations and reads
// don't.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('data version beacon', () => {
  let close;
  let req;

  before(async () => {
    const server = await createTestServer();
    close = server.close;
    req = server.req;
  });

  after(() => close());

  async function getVersion() {
    const { status, body } = await req('GET', '/api/version');
    assert.equal(status, 200);
    assert.equal(typeof body.version, 'string');
    return body.version;
  }

  it('GET /api/version returns a boot-prefixed version string', async () => {
    const version = await getVersion();
    assert.match(version, /^\d+-\d+$/);
  });

  it('a successful mutation bumps the version', async () => {
    const before_ = await getVersion();
    const { status } = await req('POST', '/api/books', { title: 'Version Bump Probe' });
    assert.equal(status, 201);
    const after_ = await getVersion();
    assert.notEqual(after_, before_);
  });

  it('a failed mutation does not bump the version', async () => {
    const before_ = await getVersion();
    const { status } = await req('POST', '/api/books', {});
    assert.equal(status, 400);
    const after_ = await getVersion();
    assert.equal(after_, before_);
  });

  it('GET requests do not bump the version', async () => {
    const before_ = await getVersion();
    await req('GET', '/api/books?limit=1');
    await req('GET', '/api/settings');
    const after_ = await getVersion();
    assert.equal(after_, before_);
  });
});
