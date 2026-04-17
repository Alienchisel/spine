import express from 'express';

const router = express.Router();

router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) return res.json([]);

  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,number_of_pages_median,publisher,cover_i,isbn&limit=10`;
    const response = await fetch(url);
    if (!response.ok) return res.status(502).json({ error: 'Open Library unavailable' });

    const data = await response.json();
    const results = (data.docs || []).map(doc => ({
      key: doc.key,
      title: doc.title,
      author: doc.author_name?.[0] || null,
      publisher: doc.publisher?.[0] || null,
      page_count: doc.number_of_pages_median || null,
      cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    }));

    res.json(results);
  } catch {
    res.status(502).json({ error: 'Failed to reach Open Library' });
  }
});

export default router;
