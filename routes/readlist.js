import express from 'express';
import db from '../db.js';
import { serveBookCardRows, LIST_BOOK_SELECT } from '../lib/books/joinedFields.js';

const router = express.Router();

router.get('/', (_req, res) => {
  // Archived books are auto-removed from on_readlist when archived (see
  // patchBook), so this filter is belt-and-suspenders. If on_readlist=1
  // somehow coexists with archived=1 (e.g. a manual SQL edit), still hide
  // it — the Archived tab is the single source of truth for archived items.
  const rows = db.prepare(`
    SELECT ${LIST_BOOK_SELECT} FROM books WHERE on_readlist = 1 AND COALESCE(archived,0) = 0
    ORDER BY readlist_position ASC, id ASC
  `).all();
  res.json(serveBookCardRows(rows));
});

router.put('/order', (req, res) => {
  const { ids } = req.body;
  // Match the shelf.js allPositiveInts pattern — `Number.isInteger(Number(id))`
  // alone accepts 0 and negatives, both of which then silently fail to match
  // the `WHERE id = ?` filter and leave readlist_position untouched. A bad
  // payload should fail loudly, not no-op.
  if (!Array.isArray(ids) || !ids.every(id => Number.isInteger(id) && id >= 1)) {
    return res.status(400).json({ error: 'ids must be an array of positive integers' });
  }
  const update = db.prepare('UPDATE books SET readlist_position = ? WHERE id = ? AND on_readlist = 1');
  db.transaction(() => {
    ids.forEach((id, i) => update.run(i, id));
  })();
  res.json({ ok: true });
});

export default router;
