import { bookRecord } from './bookRecord.js';

// Single-book "record" entries surfaced on the Stats page (longest read,
// oldest edition, most re-read, etc.). Each value is a book object via
// bookRecord(), or null when no book qualifies.
//
// Adding a new record is one line: pick a key name and pass a SQL string
// that picks a single row ordered by the metric of interest.
export function getRecords() {
  return {
    // Format-split read records — pages and minutes don't compare across
    // formats, so the longest/shortest record is computed per-format with
    // its native length unit. Replaces an older format-blind pair plus a
    // standalone longestAudiobook.
    longestReadPhysical:   bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND format = 'physical'  AND page_count > 0       ORDER BY page_count DESC LIMIT 1`),
    shortestReadPhysical:  bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND format = 'physical'  AND page_count > 0       ORDER BY page_count ASC  LIMIT 1`),
    longestReadDigital:    bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND format = 'ebook'     AND page_count > 0       ORDER BY page_count DESC LIMIT 1`),
    shortestReadDigital:   bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND format = 'ebook'     AND page_count > 0       ORDER BY page_count ASC  LIMIT 1`),
    longestReadAudiobook:  bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND format = 'audiobook' AND duration_minutes > 0 ORDER BY duration_minutes DESC LIMIT 1`),
    shortestReadAudiobook: bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL AND format = 'audiobook' AND duration_minutes > 0 ORDER BY duration_minutes ASC  LIMIT 1`),
    // Library-scoped length records — biggest/smallest book in the active
    // catalog (archived excluded), regardless of read status or ownership.
    // Surfaces the gap between what's been acquired and what's been finished
    // (e.g. a 1500-page TBR brick vs. an 800-page longest finished).
    longestLibraryPhysical:   bookRecord(`SELECT * FROM books WHERE COALESCE(archived,0) = 0 AND format = 'physical'  AND page_count > 0       ORDER BY page_count DESC LIMIT 1`),
    shortestLibraryPhysical:  bookRecord(`SELECT * FROM books WHERE COALESCE(archived,0) = 0 AND format = 'physical'  AND page_count > 0       ORDER BY page_count ASC  LIMIT 1`),
    longestLibraryDigital:    bookRecord(`SELECT * FROM books WHERE COALESCE(archived,0) = 0 AND format = 'ebook'     AND page_count > 0       ORDER BY page_count DESC LIMIT 1`),
    shortestLibraryDigital:   bookRecord(`SELECT * FROM books WHERE COALESCE(archived,0) = 0 AND format = 'ebook'     AND page_count > 0       ORDER BY page_count ASC  LIMIT 1`),
    longestLibraryAudiobook:  bookRecord(`SELECT * FROM books WHERE COALESCE(archived,0) = 0 AND format = 'audiobook' AND duration_minutes > 0 ORDER BY duration_minutes DESC LIMIT 1`),
    shortestLibraryAudiobook: bookRecord(`SELECT * FROM books WHERE COALESCE(archived,0) = 0 AND format = 'audiobook' AND duration_minutes > 0 ORDER BY duration_minutes ASC  LIMIT 1`),
    oldestEdition:    bookRecord(`SELECT * FROM books WHERE year_published IS NOT NULL ORDER BY year_published ASC LIMIT 1`),
    newestEdition:    bookRecord(`SELECT * FROM books WHERE year_published IS NOT NULL ORDER BY year_published DESC LIMIT 1`),
    firstFinished:    bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL ORDER BY date_finished ASC LIMIT 1`),
    lastFinished:     bookRecord(`SELECT * FROM books WHERE date_finished IS NOT NULL ORDER BY date_finished DESC LIMIT 1`),
    mostReread:       bookRecord(`SELECT * FROM books WHERE read_count > 1 ORDER BY read_count DESC LIMIT 1`),
  };
}
