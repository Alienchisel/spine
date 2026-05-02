import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('POST /api/upload/fetch', () => {
  let url;
  let close;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  async function req(body) {
    const res = await fetch(`${url}/api/upload/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json() };
  }

  it('returns 400 when url is missing (new URL(undefined) throws)', async () => {
    const { status, body } = await req({});
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid URL');
  });

  it('returns 400 for non-HTTPS URLs', async () => {
    // The HTTPS guard fires before any network call, so this stays hermetic.
    const { status, body } = await req({ url: 'http://example.com/cover.jpg' });
    assert.equal(status, 400);
    assert.equal(body.error, 'Only HTTPS URLs are allowed');
  });

  it('returns 400 for syntactically invalid URLs', async () => {
    const { status, body } = await req({ url: 'not a url' });
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid URL');
  });
});
