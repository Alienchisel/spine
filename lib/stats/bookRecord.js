import db from '../../db.js';
import { toCoverUrl } from '../books/normalization.js';

// Formats a single book row for use as a "record" entry (longest read,
// oldest edition, most re-read, etc.) in the stats response. Joins authors
// and converts the cover path to a URL. Returns null when no book matches.
export function bookRecord(sql) {
  const b = db.prepare(sql).get();
  if (!b) return null;
  const authors = db.prepare(
    `SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id
     WHERE ba.book_id = ? ORDER BY ba.position`
  ).all(b.id).map(r => r.name);
  return {
    id:               b.id,
    title:            b.title,
    authors,
    cover_path:       toCoverUrl(b.cover_path),
    year_published:   b.year_published,
    page_count:       b.page_count,
    date_finished:    b.date_finished,
    duration_minutes: b.duration_minutes,
  };
}
