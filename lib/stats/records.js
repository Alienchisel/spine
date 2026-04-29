import { bookRecord } from './bookRecord.js';

// Single-book "record" entries surfaced on the Stats page (longest read,
// oldest edition, most re-read, etc.). Each value is a book object via
// bookRecord(), or null when no book qualifies.
//
// Adding a new record is one line: pick a key name and pass a SQL string
// that picks a single row ordered by the metric of interest.
export function getRecords() {
  return {
    longestRead:      bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND page_count > 0 ORDER BY page_count DESC LIMIT 1`),
    shortestRead:     bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND page_count > 0 ORDER BY page_count ASC LIMIT 1`),
    longestAudiobook: bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND format = 'audiobook' AND duration_minutes > 0 ORDER BY duration_minutes DESC LIMIT 1`),
    oldestEdition:    bookRecord(`SELECT * FROM books WHERE year_published IS NOT NULL ORDER BY year_published ASC LIMIT 1`),
    newestEdition:    bookRecord(`SELECT * FROM books WHERE year_published IS NOT NULL ORDER BY year_published DESC LIMIT 1`),
    firstFinished:    bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL ORDER BY date_finished ASC LIMIT 1`),
    lastFinished:     bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL ORDER BY date_finished DESC LIMIT 1`),
    mostReread:       bookRecord(`SELECT * FROM books WHERE read_count > 1 ORDER BY read_count DESC LIMIT 1`),
  };
}
