import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('settings', () => {
  let url;
  let close;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  async function req(method, path, body) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  }

  it('GET /api/settings returns an object', async () => {
    const { status, body } = await req('GET', '/api/settings');
    assert.equal(status, 200);
    assert.equal(typeof body, 'object');
    assert.ok(body !== null);
    assert.ok(!Array.isArray(body), 'should be an object map, not an array');
  });

  it('PUT /api/settings/:key saves a value and a follow-up GET returns it', async () => {
    const key = 'daily_pages_goal';
    const { status: putStatus, body: putBody } = await req('PUT', `/api/settings/${key}`, { value: 30 });
    assert.equal(putStatus, 200);
    assert.equal(putBody.key, key);
    assert.equal(putBody.value, '30', 'values are coerced to strings on save');

    const { body: all } = await req('GET', '/api/settings');
    assert.equal(all[key], '30');
  });

  it('PUT /api/settings/:key overwrites an existing value', async () => {
    const key = 'yearly_pages_goal';
    await req('PUT', `/api/settings/${key}`, { value: 5000 });
    await req('PUT', `/api/settings/${key}`, { value: 7500 });
    const { body: all } = await req('GET', '/api/settings');
    assert.equal(all[key], '7500');
  });

  it('PUT /api/settings/:key returns 400 when value is missing', async () => {
    const { status, body } = await req('PUT', '/api/settings/some_key', {});
    assert.equal(status, 400);
    assert.equal(body.error, 'value required');
  });

  it('PUT /api/settings/:key returns 400 when value is null', async () => {
    const { status, body } = await req('PUT', '/api/settings/some_key', { value: null });
    assert.equal(status, 400);
    assert.equal(body.error, 'value required');
  });
});
