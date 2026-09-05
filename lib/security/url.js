import { lookup } from 'dns/promises';

// SSRF guard for the two user-supplied-URL fetchers (book cover URL,
// author photo URL). Spine is single-user / localhost-bound, but a
// malicious page open in another tab could still POST a URL to either
// endpoint and the server would fetch whatever it pointed at, then save
// the response body into uploads/ where the same attacker could read it
// back. Locking the protocol to https:// and rejecting hostnames that
// resolve to loopback / link-local / RFC1918 private ranges closes the
// drive-by SSRF + LAN-pivot + exfil path without restricting the user's
// legitimate use (cover and portrait URLs from public Open Library /
// Wikipedia / publisher CDNs).
//
// Tradeoff worth knowing: a user with a *private* cover mirror on their
// LAN (NAS, internal HTTP server) won't be able to fetch from it. If
// that ever comes up, the right escape hatch is an explicit allowlist
// of host suffixes, not relaxing the block.
//
// Time-of-check-time-of-use note: DNS could in theory return a different
// IP between this resolve() and the eventual fetch() (DNS rebinding).
// Closing that requires connecting directly to the resolved IP, which
// breaks SNI / Host header semantics for many CDNs. The TOCTOU window
// is narrow and the attacker still needs to control DNS for a domain
// the user types in — acceptable trade-off for Spine's threat model.

const BLOCKED_V4 = [
  // (network, mask-bits)
  ['127.0.0.0',   8],   // loopback
  ['10.0.0.0',    8],   // RFC1918 private
  ['172.16.0.0', 12],   // RFC1918 private
  ['192.168.0.0', 16],  // RFC1918 private
  ['169.254.0.0', 16],  // link-local (incl. 169.254.169.254 cloud metadata)
  ['0.0.0.0',     8],   // "this network" / null route
];

function v4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function v4InRange(ip, network, bits) {
  const ipInt = v4ToInt(ip);
  const netInt = v4ToInt(network);
  const mask = bits === 0 ? 0 : ((-1) << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function isBlockedIPv4(ip) {
  return BLOCKED_V4.some(([net, bits]) => v4InRange(ip, net, bits));
}

function isBlockedIPv6(ip) {
  const lower = ip.toLowerCase();
  // IPv6 loopback (::1) and the unspecified address.
  if (lower === '::1' || lower === '::') return true;
  // Link-local: fe80::/10
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  // Unique local (RFC4193): fc00::/7
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // IPv4-mapped: ::ffff:<v4> — peel off and re-check as v4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

class UrlError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function assertPublicHttpsUrl(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { throw new UrlError('Invalid URL', 400); }
  if (parsed.protocol !== 'https:') throw new UrlError('Only HTTPS URLs are allowed', 400);

  // Reject IP literals in the URL up front (no DNS round-trip needed).
  // node's URL.hostname strips brackets from IPv6 literals.
  const host = parsed.hostname;
  if (!host) throw new UrlError('Invalid URL', 400);

  let resolved;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    // Hostname doesn't resolve — surface as an upstream failure rather
    // than block, so the caller can return a normal "unreachable" error
    // shape instead of treating an OL hiccup as a malicious URL.
    return parsed;
  }

  for (const { address, family } of resolved) {
    const blocked = family === 4 ? isBlockedIPv4(address) : isBlockedIPv6(address);
    if (blocked) throw new UrlError('URL resolves to a non-public address', 400);
  }

  return parsed;
}

// Fetch that follows redirects MANUALLY, re-validating every hop through
// assertPublicHttpsUrl. Node's fetch defaults to redirect:'follow', so a
// bare fetch(url) after the guard is a redirect-based SSRF bypass: the
// guard only ever inspects the first URL, and a public https URL can 302
// straight to a loopback / RFC1918 / cloud-metadata address that the
// guard would have rejected up front. Both the cover- and author-photo
// fetchers legitimately depend on the Open Library -> archive.org
// redirect, so refusing redirects outright isn't an option; instead we
// re-run the guard on each Location (which also re-enforces https, so a
// downgrade to a plaintext internal service is blocked too). The caller
// owns the timeout — pass its AbortSignal in init.signal and the one
// signal covers every hop.
export async function fetchFollowingRedirects(rawUrl, init = {}, maxHops = 5) {
  let current = (await assertPublicHttpsUrl(rawUrl)).href;
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    if (hop >= maxHops) throw new UrlError('Too many redirects', 502);
    const next = new URL(location, current);
    await assertPublicHttpsUrl(next.href);   // re-validate before following
    current = next.href;
  }
}

export { UrlError };
