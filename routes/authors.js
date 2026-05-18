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

// PATCH author: gender + bio are editable. Empty string / null on
// either clears the field. CHECK constraint on gender would reject
// invalid values anyway, but we validate here too so the error is a
// clean 400 instead of a generic 500.
//
// A manual bio edit bumps `bio_fetched_at` so the auto-refresh effect
// on /authors/:id won't undo the user's edit on next visit — the
// gate's semantic shifts slightly from "last OL fetch" to "this row
// has been looked at"; both cases stop the auto-retry. The manual
// "↻ Refresh from Open Library" button still overwrites, by design.
const ALLOWED_GENDERS = new Set(['male', 'female', 'other']);
const YEAR_MIN = -3000;
const YEAR_MAX = new Date().getFullYear() + 1;
// Empty string / null clears, otherwise must be an integer in range.
// Range is wide enough for BCE classical authors (Plato et al.) on the
// low end and a small buffer past today on the high end (OL sometimes
// has speculative dates). Returns { value } on success, { error } on
// failure.
function parseYearField(raw, fieldName) {
  if (raw === '' || raw == null) return { value: null };
  const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (!Number.isInteger(n)) return { error: `${fieldName} must be an integer` };
  if (n < YEAR_MIN || n > YEAR_MAX) {
    return { error: `${fieldName} must be between ${YEAR_MIN} and ${YEAR_MAX}` };
  }
  return { value: n };
}
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  const author = db.prepare('SELECT id FROM authors WHERE id = ?').get(id);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  const body = req.body ?? {};
  const hasGender = 'gender'     in body;
  const hasBio    = 'bio'        in body;
  const hasBirth  = 'birth_year' in body;
  const hasDeath  = 'death_year' in body;
  if (!hasGender && !hasBio && !hasBirth && !hasDeath) {
    return res.status(400).json({ error: 'No supported fields to update' });
  }
  const sets = [];
  const params = [];
  if (hasGender) {
    const raw = body.gender;
    const next = raw === '' || raw == null ? null : String(raw);
    if (next !== null && !ALLOWED_GENDERS.has(next)) {
      return res.status(400).json({ error: 'Invalid gender' });
    }
    sets.push('gender = ?');
    params.push(next);
  }
  if (hasBio) {
    const raw = body.bio;
    if (raw != null && typeof raw !== 'string') {
      return res.status(400).json({ error: 'Bio must be a string' });
    }
    const next = raw == null ? null : raw.trim() || null;
    sets.push('bio = ?');
    params.push(next);
    sets.push("bio_fetched_at = datetime('now', 'localtime')");
  }
  if (hasBirth) {
    const r = parseYearField(body.birth_year, 'birth_year');
    if (r.error) return res.status(400).json({ error: r.error });
    sets.push('birth_year = ?');
    params.push(r.value);
  }
  if (hasDeath) {
    const r = parseYearField(body.death_year, 'death_year');
    if (r.error) return res.status(400).json({ error: r.error });
    sets.push('death_year = ?');
    params.push(r.value);
  }
  db.prepare(`UPDATE authors SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  res.json(loadAuthor(id));
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

// Fetch bio + portrait from Open Library and save locally. Fires only
// when the user clicks "↻ Refresh from Open Library" on the author
// page — there is no auto-refresh path. A miss (no OL match) still
// bumps bio_fetched_at so the row no longer reads as "never looked up".
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
