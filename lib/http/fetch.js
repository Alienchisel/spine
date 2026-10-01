// Outbound HTTP for Open Library, Google Books and user-supplied image
// URLs. Covers, author lookups and the search route each had their own
// copy of this (three user-agent strings, 5 / 8 / 15 s timeouts, two error
// conventions), and the copies had drifted: fetching an author portrait by
// URL had no image-type check and no size cap, and read the whole body
// into memory, where the cover path checked both.
import { assertPublicHttpsUrl, fetchFollowingRedirects, UrlError } from '../security/url.js';
import { MAX_IMAGE_BYTES } from '../images.js';

// Open Library returns 403 to the default fetch user agent; identify
// ourselves (Google Books accepts anything, but a polite UA doesn't hurt).
export const USER_AGENT = 'Spine/1.0 (personal library tracker; +https://github.com/Alienchisel/spine)';

// One timed attempt. Throws a classified error:
//   transient      — worth one retry: timeout (AbortError), TCP-level
//                    failure (TypeError), HTTP 429 or 5xx
//   networkFailure — the request never got an HTTP answer (the
//                    archive.org-unreachable shape callers report)
//   status         — the HTTP status, for !ok responses
// guardRedirects follows redirects manually through the SSRF guard (use it
// for anything whose body gets saved); a blocked hop rethrows the UrlError
// (status 400) as-is.
export async function fetchOnce(url, { timeoutMs = 8000, accept, guardRedirects = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = {
    signal: controller.signal,
    headers: { 'User-Agent': USER_AGENT, ...(accept ? { Accept: accept } : {}) },
  };
  let res;
  try {
    res = guardRedirects ? await fetchFollowingRedirects(url, init) : await fetch(url, init);
  } catch (err) {
    if (err instanceof UrlError) throw err;
    const transient = err?.name === 'AbortError' || err instanceof TypeError;
    const e = new Error(err?.message || 'Network error');
    e.transient = transient;
    e.networkFailure = transient;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const e = new Error(`Upstream returned ${res.status}: ${url}`);
    e.transient = res.status === 429 || (res.status >= 500 && res.status < 600);
    e.networkFailure = false;
    e.status = res.status;
    throw e;
  }
  return res;
}

// Run `attempt` and retry once after a short pause if it failed
// transiently. Absorbs the Open Library / archive.org flakes (a 502 or a
// refused connection that clears a second later) without surfacing them.
export async function withRetry(attempt) {
  try {
    return await attempt();
  } catch (err) {
    if (!err.transient) throw err;
    await new Promise(r => setTimeout(r, 300));
    return attempt();
  }
}

function clientError(message) {
  const e = new Error(message);
  e.status = 400;
  e.clientError = true;
  return e;
}

// Read a response body, aborting as soon as it passes maxBytes rather than
// buffering an arbitrarily large download first.
async function readCapped(res, maxBytes) {
  const declared = parseInt(res.headers?.get?.('content-length') || '0', 10);
  if (declared > maxBytes) throw clientError('Image too large');
  if (!res.body?.getReader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw clientError('Image too large');
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw clientError('Image too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// Download an image from a user-supplied URL: public https only (SSRF
// guard, re-checked on every redirect hop), one retry on transient
// failure, image/* content type, at most maxBytes. Validation failures
// throw with status 400 and clientError: true; upstream failures keep the
// fetchOnce classification (networkFailure / status).
export async function downloadImage(url, { timeoutMs = 8000, maxBytes = MAX_IMAGE_BYTES } = {}) {
  try {
    await assertPublicHttpsUrl(url);
  } catch (err) {
    throw clientError(err.message || 'Invalid URL');
  }
  let res;
  try {
    res = await withRetry(() => fetchOnce(url, { timeoutMs, guardRedirects: true }));
  } catch (err) {
    if (err instanceof UrlError) throw clientError(err.message);
    throw err;
  }
  const contentType = res.headers?.get?.('content-type') || '';
  if (!contentType.startsWith('image/')) throw clientError('URL does not point to an image');
  return readCapped(res, maxBytes);
}
