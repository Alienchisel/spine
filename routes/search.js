import express from 'express';

const router = express.Router();

// Open Library returns 403 to the default node-fetch User-Agent (their
// bot protection started enforcing this in 2026); identifying ourselves
// is required for the request to succeed at all. Mirrors the UA set in
// lib/authors/openLibrary.js.
const OL_USER_AGENT = 'Spine/1.0 (personal library tracker; charlesss@gmail.com)';

function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': OL_USER_AGENT },
  }).finally(() => clearTimeout(timer));
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
    const response = await fetchWithTimeout(url);
    if (!response.ok) return res.status(502).json({ error: 'Open Library unavailable' });

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
        cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
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
