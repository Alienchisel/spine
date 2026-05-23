import express from 'express';
import multer from 'multer';
import db, { nrm } from '../db.js';
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

const AUTHOR_COLUMNS = 'id, name, gender, alias_group_id, bio, birth_date, death_date, photo_path, ol_key, bio_fetched_at';

function loadAuthor(id) {
  return db.prepare(`SELECT ${AUTHOR_COLUMNS} FROM authors WHERE id = ?`).get(id);
}

// Index of every author with their book count + flags for which curation
// fields are populated. Backs /authors (the index page). Bio/photo/ol_key
// are returned as booleans (0/1) rather than the full strings so the
// response stays small — the index doesn't need bio bodies, just whether
// each author has one. Dates / gender are returned in full because the
// table shows them. Sorted alphabetically (NOCASE) so the client can
// render straight without a follow-up sort step.
//
// Optional `?q=` substring filter (case-insensitive LIKE on name) caps
// results to 20 — sized for the command palette's author search section.
// Bare callers (AuthorsIndex) omit `q` and get the full corpus unchanged.
router.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    // Match against nrm(name) so diacritic and ligature variants collide
    // ("Stanislaw" finds "Stanisław", "böhm" finds "Böhm-Bawerk", etc.).
    // nrm() lowercases too, so the literal LIKE pattern needs to be
    // lowercased — and the escape pass for LIKE wildcards happens on the
    // raw query before the nrm() pass, since SQLite's LIKE-wildcard
    // characters (% _) are not letters and nrm() leaves them alone.
    const escaped = q.replace(/[\\%_]/g, m => '\\' + m);
    const like = `%${nrm(escaped)}%`;
    const rows = db.prepare(`
      SELECT
        a.id,
        a.name,
        a.gender,
        a.birth_date,
        a.death_date,
        (a.bio IS NOT NULL)         AS has_bio,
        (a.photo_path IS NOT NULL)  AS has_photo,
        (a.ol_key IS NOT NULL)      AS has_ol_key,
        COUNT(DISTINCT ba.book_id)  AS book_count,
        COUNT(DISTINCT sa.story_id) AS story_count
      FROM authors a
      LEFT JOIN book_authors  ba ON ba.author_id  = a.id
      LEFT JOIN story_authors sa ON sa.author_id = a.id
      WHERE nrm(a.name) LIKE ? ESCAPE '\\'
      GROUP BY a.id
      ORDER BY a.name COLLATE NOCASE
      LIMIT 20
    `).all(like);
    return res.json(rows);
  }
  // story_count picks up per-story contributors (anthology authors who
  // aren't bylined on the containing book). Counted as DISTINCT story_id
  // so a story with multiple author rows doesn't double; book_count gets
  // DISTINCT too for symmetry now that we're joining two tables.
  // has_stale_tense fires when a deceased author's bio opens with
  // "is a/an/the ..." (present tense) without a "was" appearing in the
  // first 100 chars — i.e. a bio written for a still-living author that
  // wasn't updated when the death date was added. Drives the
  // "Deceased authors have past-tense bio" audit row and the
  // sort=stale_tense order in AuthorsIndex.
  const rows = db.prepare(`
    SELECT
      a.id,
      a.name,
      a.gender,
      a.birth_date,
      a.death_date,
      (a.bio IS NOT NULL)         AS has_bio,
      (a.photo_path IS NOT NULL)  AS has_photo,
      (a.ol_key IS NOT NULL)      AS has_ol_key,
      (
        a.death_date IS NOT NULL AND a.bio IS NOT NULL AND a.bio != ''
        AND (SUBSTR(a.bio, 1, 100) LIKE '% is a %'
          OR SUBSTR(a.bio, 1, 100) LIKE '% is an %'
          OR SUBSTR(a.bio, 1, 100) LIKE '% is the %')
        AND SUBSTR(a.bio, 1, 100) NOT LIKE '% was %'
      )                            AS has_stale_tense,
      COUNT(DISTINCT ba.book_id)  AS book_count,
      COUNT(DISTINCT sa.story_id) AS story_count
    FROM authors a
    LEFT JOIN book_authors  ba ON ba.author_id  = a.id
    LEFT JOIN story_authors sa ON sa.author_id = a.id
    GROUP BY a.id
    ORDER BY a.name COLLATE NOCASE
  `).all();
  res.json(rows);
});

// Random author — backs the `R` shortcut on author pages. Sits above
// /:id so "random" isn't read as a numeric id. Only picks from authors
// who are actually bylined on at least one book; pure-alias rows with
// zero books would land the user on a dead-end page.
router.get('/random', (_req, res) => {
  const row = db.prepare(`
    SELECT a.id
    FROM authors a
    JOIN book_authors ba ON ba.author_id = a.id
    GROUP BY a.id
    ORDER BY RANDOM()
    LIMIT 1
  `).get();
  if (!row) return res.status(404).json({ error: 'No authors' });
  res.json({ id: row.id });
});

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
  // Author bibliographies are history-style — archived books are part
  // of the author's catalog and should show up. Without the override,
  // listBooks's default-hide-archived would exclude an author's only
  // book when archived, producing a "0 books" page contradicting the
  // index's "1 book" count. The card grid still dims archived covers
  // so the user sees the state at a glance.
  const { books, total } = listBooks({ field: 'author', value: author.name, archived: 'any', sort, limit: 200, offset: 0 });
  // Per-story attributions: every story bylined to this author plus the
  // parent book it lives inside. Anthology contributors who aren't on the
  // book's byline would otherwise render as a blank author page (see
  // story_authors-only authors like Bruce McAllister, Joyce Carol Oates).
  // Sorted by parent book title then position-within-book so multi-story
  // contributors group naturally by anthology.
  const stories = db.prepare(`
    SELECT s.id   AS story_id,
           s.title AS story_title,
           b.id   AS book_id,
           b.title AS book_title
    FROM story_authors sa
    JOIN stories s ON s.id = sa.story_id
    JOIN books   b ON b.id = s.book_id
    WHERE sa.author_id = ?
    ORDER BY b.title COLLATE NOCASE, COALESCE(s.position, 9999), s.id
  `).all(id);
  res.json({ ...author, aliases, books, total, stories });
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
// Empty string / null clears. Otherwise accepts:
//   "YYYY"           — year only ("1938", "-428" for BCE)
//   "YYYY-MM"        — year + month ("1938-07")
//   "YYYY-MM-DD"     — full date ("1938-07-18")
// A bare integer is also accepted and stringified for backward-compat
// with year-only callers. Year range is wide enough for BCE classical
// authors (Plato et al.) on the low end and a small buffer past today
// on the high end. Returns { value } on success, { error } on failure.
const DATE_RE = /^(-?\d{1,4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;
function parseDateField(raw, fieldName) {
  if (raw === '' || raw == null) return { value: null };
  const s = typeof raw === 'number' ? String(raw) : String(raw).trim();
  const m = s.match(DATE_RE);
  if (!m) return { error: `${fieldName} must be YYYY, YYYY-MM, or YYYY-MM-DD` };
  const year = parseInt(m[1], 10);
  if (year < YEAR_MIN || year > YEAR_MAX) {
    return { error: `${fieldName} year must be between ${YEAR_MIN} and ${YEAR_MAX}` };
  }
  return { value: s };
}
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid author id' });
  const author = db.prepare('SELECT id FROM authors WHERE id = ?').get(id);
  if (!author) return res.status(404).json({ error: 'Author not found' });
  const body = req.body ?? {};
  const hasGender = 'gender'     in body;
  const hasBio    = 'bio'        in body;
  const hasBirth  = 'birth_date' in body;
  const hasDeath  = 'death_date' in body;
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
    const r = parseDateField(body.birth_date, 'birth_date');
    if (r.error) return res.status(400).json({ error: r.error });
    sets.push('birth_date = ?');
    params.push(r.value);
  }
  if (hasDeath) {
    const r = parseDateField(body.death_date, 'death_date');
    if (r.error) return res.status(400).json({ error: r.error });
    sets.push('death_date = ?');
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
// page — there is no auto-refresh path.
//
// Non-destructive merge: every user-facing field (bio / birth_date /
// death_date / photo_path) is preserved if already set, and OL only
// fills the blanks (`COALESCE(existing, ol_value)`). A user who wants
// to replace a wrong value can clear it via the inline editor and
// re-run Refresh. `ol_key` is the one exception — it always tracks
// the current OL match because it's system metadata, not user data.
//
// A miss (no OL match) still bumps bio_fetched_at so the row no longer
// reads as "never looked up".
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
    if (author.photo_path && found.photo_path) {
      // OL handed us a portrait we won't use because the existing one
      // wins under the non-destructive merge. Delete the just-downloaded
      // orphan so uploads/authors/ doesn't accumulate strays on every
      // refresh.
      await deleteAuthorPhoto(found.photo_path);
    }
    db.prepare(`
      UPDATE authors SET
        bio        = COALESCE(bio,        ?),
        birth_date = COALESCE(birth_date, ?),
        death_date = COALESCE(death_date, ?),
        photo_path = COALESCE(photo_path, ?),
        ol_key     = ?,
        bio_fetched_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(found.bio, found.birth_date, found.death_date, found.photo_path, found.ol_key, id);
    res.json(loadAuthor(id));
  } catch (err) {
    res.status(502).json({ error: 'Open Library lookup failed', detail: String(err.message || err) });
  }
});

export default router;
