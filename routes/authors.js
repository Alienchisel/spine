import express from 'express';
import { linkAuthorAliases, unlinkAuthorAlias } from '../lib/books/people.js';

const router = express.Router();

// Symmetric pen-name linking: POST with {other_id: N} groups this author
// with N as aliases of the same person. Merges groups deterministically
// (lower alias_group_id wins) when either author is already in a group.
router.post('/:id/alias-link', (req, res) => {
  const id = Number(req.params.id);
  const other = Number(req.body?.other_id);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(other) || other < 1) {
    return res.status(400).json({ error: 'Invalid author id' });
  }
  if (id === other) return res.status(400).json({ error: 'Cannot alias an author with themselves' });
  const ok = linkAuthorAliases(id, other);
  if (ok === null) return res.status(404).json({ error: 'Author not found' });
  res.json({ ok: true });
});

// Remove the author from their alias group. Dissolves the group if only
// one member remains so a stamped alias_group_id never represents a
// phantom singleton group.
router.delete('/:id/alias-link', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  const ok = unlinkAuthorAlias(id);
  if (ok === null) return res.status(404).json({ error: 'Author not found' });
  res.json({ ok: true });
});

export default router;
