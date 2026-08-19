import express from 'express';
import db from '../db.js';

const router = express.Router();

// Index of every user-defined tag with its book count. Backs /tags (the
// index page). Virtual tags (Long, Antique, Vintage, …) live as
// computed rules elsewhere — they aren't in this table and aren't
// returned here, which is correct: the index is for curation (merge /
// rename / prune) and you can't prune a virtual rule.
//
// pruneOrphanTags() runs on book mutations, so a 0-count row shouldn't
// normally exist — but the LEFT JOIN keeps the index honest if one ever
// slips through (it'd sort first under "Books asc" so it's easy to spot
// and delete).
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      t.id,
      t.name,
      COUNT(bt.book_id) AS book_count
    FROM tags t
    LEFT JOIN book_tags bt ON bt.tag_id = t.id
    GROUP BY t.id
    ORDER BY nrm(t.name)
  `).all();
  res.json(rows);
});

export default router;
