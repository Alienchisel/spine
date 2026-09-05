import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFollowingRedirects, assertPublicHttpsUrl, UrlError } from '../lib/security/url.js';

// IP literals resolve through dns.lookup without touching the network, so
// every case here is hermetic. A public literal (example.com's historical
// address) passes the guard; loopback / link-local literals are blocked.
const PUBLIC = 'https://93.184.216.34/';
const PUBLIC2 = 'https://93.184.216.34/final';
const METADATA = 'https://169.254.169.254/latest/meta-data/';
const LOOPBACK = 'https://127.0.0.1/admin';

function redirectTo(location) {
  return { status: 302, headers: new Headers({ location }) };
}
function ok() {
  return { status: 200, headers: new Headers() };
}

describe('fetchFollowingRedirects (SSRF redirect guard)', () => {
  it('passes a non-redirect response through and forces redirect:manual', async () => {
    let seenInit = null;
    const fetchMock = mock.method(globalThis, 'fetch', async (_url, init) => {
      seenInit = init;
      return ok();
    });
    try {
      const res = await fetchFollowingRedirects(PUBLIC, { headers: { 'User-Agent': 'x' } });
      assert.equal(res.status, 200);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(seenInit.redirect, 'manual', 'must not let fetch auto-follow redirects');
      assert.equal(seenInit.headers['User-Agent'], 'x', 'caller init is preserved');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('blocks a redirect to the cloud-metadata address without fetching it', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => redirectTo(METADATA));
    try {
      await assert.rejects(
        () => fetchFollowingRedirects(PUBLIC),
        (err) => err instanceof UrlError && /non-public address/.test(err.message),
      );
      // Exactly one call — the redirect target was never fetched.
      assert.equal(fetchMock.mock.callCount(), 1,
        'the private redirect target must not be fetched');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('blocks a redirect to loopback', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => redirectTo(LOOPBACK));
    try {
      await assert.rejects(() => fetchFollowingRedirects(PUBLIC), UrlError);
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('blocks an https->http downgrade redirect', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => redirectTo('http://93.184.216.34/'));
    try {
      await assert.rejects(
        () => fetchFollowingRedirects(PUBLIC),
        (err) => err instanceof UrlError && /HTTPS/.test(err.message),
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('follows a public->public redirect (the OL -> archive.org case)', async () => {
    let call = 0;
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      call += 1;
      return call === 1 ? redirectTo(PUBLIC2) : ok();
    });
    try {
      const res = await fetchFollowingRedirects(PUBLIC);
      assert.equal(res.status, 200);
      assert.equal(fetchMock.mock.callCount(), 2, 'should follow the one public hop');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('rejects a redirect loop past maxHops instead of spinning forever', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => redirectTo(PUBLIC));
    try {
      await assert.rejects(
        () => fetchFollowingRedirects(PUBLIC, {}, 3),
        (err) => err instanceof UrlError && /Too many redirects/.test(err.message),
      );
      assert.equal(fetchMock.mock.callCount(), 4, 'initial + 3 hops, then give up');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('rejects a non-https initial URL before any fetch', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => ok());
    try {
      await assert.rejects(() => fetchFollowingRedirects('http://93.184.216.34/'), UrlError);
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('assertPublicHttpsUrl still blocks a direct private literal', async () => {
    await assert.rejects(() => assertPublicHttpsUrl(METADATA), UrlError);
  });
});
