import express from 'express';

const router = express.Router();

// Open Library returns 403 to the default node-fetch User-Agent (their
// bot protection started enforcing this in 2026); identifying ourselves
// is required for the request to succeed at all. Mirrors the UA set in
// lib/authors/openLibrary.js.
const OL_USER_AGENT = 'Spine/1.0 (personal library tracker; +https://github.com/Alienchisel/spine)';

function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': OL_USER_AGENT },
  }).finally(() => clearTimeout(timer));
}

// One OL fetch attempt with transient-failure classification — matches
// the pattern in lib/authors/openLibrary.js. AbortError + TypeError =
// network transient, 5xx + 429 = HTTP transient, 4xx = permanent.
// Used by the cover-wizard search path; /description doesn't need it
// because that route already swallows failures into { description: null }.
async function fetchOLOnce(url, ms) {
  let res;
  try {
    res = await fetchWithTimeout(url, ms);
  } catch (err) {
    const transient = err?.name === 'AbortError' || err instanceof TypeError;
    const e = new Error(err?.message || 'Network error');
    e.transient = transient;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`OL ${res.status}`);
    e.transient = res.status === 429 || (res.status >= 500 && res.status < 600);
    e.status = res.status;
    throw e;
  }
  return res;
}

// Retry-once wrapper for the OL search path. Same shape as the author
// search-ol retry; without it, transient OL flakes (Jane Jacobs-style
// 502 at 10s followed by clean 200 a second later) surface as a
// 'Search failed' banner in the cover wizard.
async function fetchOLWithRetry(url, ms) {
  try {
    return await fetchOLOnce(url, ms);
  } catch (err) {
    if (!err.transient) throw err;
    await new Promise(r => setTimeout(r, 300));
    return fetchOLOnce(url, ms);
  }
}

router.get('/description', async (req, res) => {
  const { key } = req.query;
  if (!key?.startsWith('/works/')) return res.status(400).json({ error: 'Invalid key' });
  try {
    const response = await fetchWithTimeout(`https://openlibrary.org${key}.json`);
    if (!response.ok) return res.json({ description: null });
    const data = await response.json();
    const desc = data.description;
    const description = !desc ? null : typeof desc === 'string' ? desc : (desc.value || null);
    res.json({ description });
  } catch {
    res.json({ description: null });
  }
});

router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) return res.json([]);

  try {
    // Accept ISBN-10 (with optional X check digit) and ISBN-13. Uppercasing
    // first so a lowercased 'x' from the search bar still matches and lands
    // in the outbound query in canonical form. Mirrors ingest.js:24.
    const stripped = q.replace(/[-\s]/g, '').toUpperCase();
    const isIsbn = /^\d{13}$|^\d{9}[\dX]$/.test(stripped);
    const olQuery = isIsbn ? `isbn:${stripped}` : q;
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(olQuery)}&fields=key,title,author_name,number_of_pages_median,publisher,cover_i,isbn&limit=10`;
    // OL's /search.json is a multi-token query against the full index and
    // routinely takes 1–3s, with frequent spikes past 5s under load. The
    // shared 5s default trips often enough to surface "Search failed" in
    // the cover-audit wizard on otherwise valid queries — give it room.
    // /description (key lookup, ~200ms) keeps the 5s default; no need to
    // wait longer on the fast path.
    // Retry absorbs the transient flake shape (502 on first hit, clean
    // 200 ~1s later) that surfaces a spurious 'Search failed' otherwise.
    const response = await fetchOLWithRetry(url, 15000);
    const data = await response.json();
    const docs = data.docs || [];

    const results = docs.map((doc) => {
      const isbns = doc.isbn || [];
      return {
        key: doc.key,
        title: doc.title,
        authors: doc.author_name?.slice(0, 5) || [],
        publisher: doc.publisher?.[0] || null,
        page_count: doc.number_of_pages_median || null,
        cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg?default=false` : null,
        isbn_10: isbns.find(i => i.length === 10) || null,
        isbn_13: isbns.find(i => i.length === 13) || null,
      };
    });

    res.json(results);
  } catch {
    res.status(502).json({ error: 'Failed to reach Open Library' });
  }
});

export default router;
