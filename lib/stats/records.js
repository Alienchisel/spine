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
    // Sort by edition year when known (translation, audiobook, reprint year),
    // falling back to year_published (original work year) — so a 2013 e-book
    // of a 17th-c. work isn't misreported as the oldest edition in the library.
    oldestEdition:    bookRecord(`SELECT * FROM books WHERE year_published IS NOT NULL ORDER BY COALESCE(year_edition, year_published) ASC LIMIT 1`),
    newestEdition:    bookRecord(`SELECT * FROM books WHERE year_published IS NOT NULL ORDER BY COALESCE(year_edition, year_published) DESC LIMIT 1`),
    // firstFinished / lastFinished derive from the reads table — the
    // earliest / most-recent finish across all books. Pre-Phase-2 this
    // ordered by books.date_finished, which only ever held the first-
    // read date; lastFinished was therefore silently wrong on any book
    // with a re-read (the more recent finish was hidden in reads, the
    // record always showed the first-finish date). The COALESCE
    // fallback to date_finished handles books that have a date on the
    // book row but no reads row (pre-cascade imports); Phase 3 drops
    // that fallback once the columns are removed. dateFinishedFrom
    // points bookRecord at the aliased column so the response shows
    // the effective date, not the (potentially stale) book column.
    firstFinished: bookRecord(`
      SELECT b.*,
        COALESCE((SELECT MIN(date_finished) FROM reads WHERE reads.book_id = b.id), b.date_finished) AS effective_date_finished
      FROM books b
      WHERE COALESCE((SELECT MIN(date_finished) FROM reads WHERE reads.book_id = b.id), b.date_finished) IS NOT NULL
      ORDER BY effective_date_finished ASC
      LIMIT 1
    `, { dateFinishedFrom: 'effective_date_finished' }),
    lastFinished: bookRecord(`
      SELECT b.*,
        COALESCE((SELECT MAX(date_finished) FROM reads WHERE reads.book_id = b.id), b.date_finished) AS effective_date_finished
      FROM books b
      WHERE COALESCE((SELECT MAX(date_finished) FROM reads WHERE reads.book_id = b.id), b.date_finished) IS NOT NULL
      ORDER BY effective_date_finished DESC
      LIMIT 1
    `, { dateFinishedFrom: 'effective_date_finished' }),
    mostReread:       bookRecord(`SELECT * FROM books WHERE read_count > 1 ORDER BY read_count DESC LIMIT 1`),
  };
}
