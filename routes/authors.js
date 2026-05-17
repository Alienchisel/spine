import express from 'express';
import multer from 'multer';
import db from '../db.js';
import { linkAuthorAliases, unlinkAuthorAlias } from '../lib/books/people.js';
import { listBooks } from '../lib/books/repository.js';
import { lookupAuthor } from '../lib/authors/openLibrary.js';
import { saveAuthorPhotoFromBuffer, deleteAuthorPhoto } from '../lib/authors/photos.js';

const router = express.Router();

// Same memoryStorage/multer setup as routes/uploads.js — 10 MB cap,
// image MIME types only. Manual portrait uploads go through here; the
// OL download path bypasses multer and writes directly via the
// shared photos.js helper.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      const err = new Error('Only images allowed');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

const AUTHOR_COLUMNS = 'id, name, gender, alias_group_id, bio, birth_year, death_year, photo_path, ol_key, bio_fetched_at';

function loadAuthor(id) {
  return db.prepare(`SELECT ${AUTHOR_COLUMNS} FROM authors WHERE id = ?`).get(id);
}

// Author detail: returns the author's identity, alias siblings, and the
// books bylined under THIS specific author (not the alias group as a
// whole — the aliases UI lets the user navigate to a sibling's page for
// their bibliography). Books reuse the listBooks shape so the client can
// drop them into the same BookCard grid the BrowsePage uses.
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  const author = loadAuthor(id);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  const aliases = author.alias_group_id != null
    ? db.prepare('SELECT id, name FROM authors WHERE alias_group_id = ? AND id != ? ORDER BY name').all(author.alias_group_id, id)
    : [];
  const sort = req.query.sort || 'year_published';
  const { books, total } = listBooks({ field: 'author', value: author.name, sort, limit: 200, offset: 0 });
  res.json({ ...author, aliases, books, total });
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

// Manual portrait upload (file picker or pasted clipboard image).
// Replaces the existing photo if any; deletes the prior file
// best-effort. Bio / dates / ol_key are untouched — this is portrait-
// only override and meant for the cases where OL has the wrong picture
// (or no picture) and the user has a better one.
router.post('/:id/photo', photoUpload.single('photo'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const author = loadAuthor(id);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  try {
    const photo_path = await saveAuthorPhotoFromBuffer(id, req.file.buffer);
    if (author.photo_path && author.photo_path !== photo_path) {
      await deleteAuthorPhoto(author.photo_path);
    }
    db.prepare('UPDATE authors SET photo_path = ? WHERE id = ?').run(photo_path, id);
    res.json(loadAuthor(id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to save photo', detail: String(err.message || err) });
  }
});

// Delete the manual or OL-fetched portrait so the page falls back to
// the skeleton. Useful when the user wants to clear a bad OL picture
// without uploading a replacement yet.
router.delete('/:id/photo', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  const author = loadAuthor(id);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  if (author.photo_path) await deleteAuthorPhoto(author.photo_path);
  db.prepare('UPDATE authors SET photo_path = NULL WHERE id = ?').run(id);
  res.json(loadAuthor(id));
});

// Fetch bio + portrait from Open Library and save locally. Manual or
// auto-triggered by the client when bio_fetched_at is null. A miss
// (no OL match) still bumps bio_fetched_at so the auto-refresh effect
// doesn't keep retrying every visit — the manual button is the way to
// re-attempt after a real failure.
router.post('/:id/refresh', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  const author = loadAuthor(id);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  try {
    const found = await lookupAuthor(author.name, id);
    if (!found) {
      db.prepare("UPDATE authors SET bio_fetched_at = datetime('now', 'localtime') WHERE id = ?").run(id);
      return res.json(loadAuthor(id));
    }
    if (author.photo_path && found.photo_path && author.photo_path !== found.photo_path) {
      // Best-effort cleanup of the prior portrait; intentionally awaited
      // so the unlink completes before we respond and the disk doesn't
      // accumulate orphans on rapid refreshes.
      await deleteAuthorPhoto(author.photo_path);
    }
    db.prepare(`
      UPDATE authors SET
        bio = ?, birth_year = ?, death_year = ?, photo_path = COALESCE(?, photo_path),
        ol_key = ?, bio_fetched_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(found.bio, found.birth_year, found.death_year, found.photo_path, found.ol_key, id);
    res.json(loadAuthor(id));
  } catch (err) {
    res.status(502).json({ error: 'Open Library lookup failed', detail: String(err.message || err) });
  }
});

export default router;
