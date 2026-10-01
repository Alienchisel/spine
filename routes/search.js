import express from 'express';
import { fetchOnce, withRetry } from '../lib/http/fetch.js';

const router = express.Router();

// Open Library fetches go through the shared client (lib/http/fetch.js):
// our user agent (OL 403s the default), a timeout, and — for search — one
// retry on a transient failure.

router.get('/description', async (req, res) => {
  const { key } = req.query;
  if (!key?.startsWith('/works/')) return res.status(400).json({ error: 'Invalid key' });
  try {
    // ~200 ms key lookup: 5 s, no retry; any failure is just 'no description'.
    const response = await fetchOnce(`https://openlibrary.org${key}.json`, { timeoutMs: 5000 });
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
    const response = await withRetry(() => fetchOnce(url, { timeoutMs: 15000 }));
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
