import express from 'express';
import db from '../db.js';
import { linkAuthorAliases, unlinkAuthorAlias } from '../lib/books/people.js';
import { listBooks } from '../lib/books/repository.js';

const router = express.Router();

// Author detail: returns the author's identity, alias siblings, and the
// books bylined under THIS specific author (not the alias group as a
// whole — the aliases UI lets the user navigate to a sibling's page for
// their bibliography). Books reuse the listBooks shape so the client can
// drop them into the same BookCard grid the BrowsePage uses.
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  const author = db.prepare('SELECT id, name, gender, alias_group_id FROM authors WHERE id = ?').get(id);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  const aliases = author.alias_group_id != null
    ? db.prepare('SELECT id, name FROM authors WHERE alias_group_id = ? AND id != ? ORDER BY name').all(author.alias_group_id, id)
    : [];
  const sort = req.query.sort || 'year_published';
  const { books, total } = listBooks({ field: 'author', value: author.name, sort, limit: 200, offset: 0 });
  res.json({ id: author.id, name: author.name, gender: author.gender, aliases, books, total });
});

// PATCH author: currently only gender is editable. Empty string / null
// clears it back to "unassigned". CHECK constraint on the column would
// reject any other value, but validate here too so the error is a clean
// 400 instead of a generic 500.
const ALLOWED_GENDERS = new Set(['male', 'female', 'other']);
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  const author = db.prepare('SELECT id FROM authors WHERE id = ?').get(id);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  if (!('gender' in (req.body ?? {}))) return res.status(400).json({ error: 'No supported fields to update' });
  const raw = req.body.gender;
  const next = raw === '' || raw == null ? null : String(raw);
  if (next !== null && !ALLOWED_GENDERS.has(next)) {
    return res.status(400).json({ error: 'Invalid gender' });
  }
  db.prepare('UPDATE authors SET gender = ? WHERE id = ?').run(next, id);
  const updated = db.prepare('SELECT id, name, gender, alias_group_id FROM authors WHERE id = ?').get(id);
  res.json(updated);
});

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
