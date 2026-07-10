import { Link } from 'react-router-dom';
import { formatPartialDate } from '../../utils.js';
import { formatYear, pluralWord, fmtHM } from '../../utils.js';

function Row({ label, children }) {
  return (
    <div className="flex gap-2">
      <dt className="text-neutral-500 w-24 flex-shrink-0">{label}</dt>
      <dd className="text-neutral-300">{children}</dd>
    </div>
  );
}

function locationCrumb(loc) {
  if (loc.shelf_id)    return `${loc.building} › ${loc.room} › ${loc.unit} › ${loc.shelf}`;
  if (loc.unit_id)     return `${loc.building} › ${loc.room} › ${loc.unit}`;
  if (loc.room_id)     return `${loc.building} › ${loc.room}`;
  return loc.building;
}

// year_edition's meaning shifts by format: for a physical artifact it
// names the printing year (what drives Antique/Vintage); for an ebook
// it's the year of the text content (a Kindle "release date" is mostly
// Amazon-noise — what matters is which translation/revision you're
// reading); for an audiobook it's the recording year. The label
// reflects that so "this edition" doesn't mistakenly read as "this
// digital file" on ebooks.
function editionLabel(book) {
  if (book.format === 'physical')  return 'this printing';
  if (book.format === 'audiobook') return 'this recording';
  if (book.format === 'ebook')     return book.translators?.length > 0 ? 'this translation' : 'this text';
  return 'this edition';
}

export default function MetadataList({ book, location, linkState }) {
  return (
    <dl className="space-y-1.5 text-sm mb-6">
      {book.fiction !== null && book.fiction !== undefined && (
        <Row label="Type">
          {book.fiction ? 'Fiction' : 'Non-fiction'}
          {book.source_type && ` — ${book.source_type.charAt(0).toUpperCase() + book.source_type.slice(1)} source`}
        </Row>
      )}
      {book.format && (
        <Row label="Format">
          <span className="capitalize">
            {book.format === 'ebook' ? 'Digital' : book.format.charAt(0).toUpperCase() + book.format.slice(1)}
            {book.binding && ` — ${book.binding.charAt(0).toUpperCase() + book.binding.slice(1)}`}
            {Boolean(book.owned) && book.condition && ` (${book.condition.replace(/\b\w/g, c => c.toUpperCase())})`}
          </span>
        </Row>
      )}
      {book.narrators?.length > 0 && (
        <Row label={pluralWord(book.narrators.length, 'Narrator')}>
          {book.narrators.map((n, i) => (
            <span key={n.id}>
              {i > 0 && <span className="text-neutral-600">, </span>}
              <Link to={`/browse/narrator/${encodeURIComponent(n.name)}`} state={linkState} className="hover:text-white transition-colors">
                {n.name}
              </Link>
            </span>
          ))}
        </Row>
      )}
      {book.year_published != null && (
        <Row label="Published">
          {book.year_published_approximate ? 'ca. ' : ''}{formatYear(book.year_published)}
          {book.year_edition && book.year_edition !== book.year_published
            ? ` (${editionLabel(book)} ${book.year_approximate ? 'ca. ' : ''}${formatYear(book.year_edition)})`
            : ''}
        </Row>
      )}
      {book.year_published == null && book.year_edition != null && (
        <Row label="Edition">{book.year_approximate ? `ca. ${formatYear(book.year_edition)}` : formatYear(book.year_edition)}</Row>
      )}
      {book.format === 'audiobook' && book.duration_minutes > 0 && (
        <Row label="Length">
          {fmtHM(book.duration_minutes)}
        </Row>
      )}
      {book.format !== 'audiobook' && book.page_count > 0 && (
        <Row label="Length">{book.page_count} pages</Row>
      )}
      {Boolean(book.abridged) && (
        <Row label="Edition">Abridged</Row>
      )}
      {book.language && book.language !== 'English' && (
        <Row label="Language">
          <Link to={`/browse/language/${encodeURIComponent(book.language)}`} state={linkState} className="hover:text-white transition-colors">
            {book.language}
          </Link>
        </Row>
      )}
      {book.original_language && (
        <Row label="Original">
          <Link to={`/browse/original_language/${encodeURIComponent(book.original_language)}`} state={linkState} className="hover:text-white transition-colors">
            {book.original_language}
          </Link>
        </Row>
      )}
      {book.translators?.length > 0 && (
        <Row label={pluralWord(book.translators.length, 'Translator')}>
          {book.translators.map((t, i) => (
            <span key={t.id}>
              {i > 0 && <span className="text-neutral-600">, </span>}
              <Link to={`/browse/translator/${encodeURIComponent(t.name)}`} state={linkState} className="hover:text-white transition-colors">
                {t.name}
              </Link>
            </span>
          ))}
        </Row>
      )}
      {book.publisher && (
        <Row label="Publisher">
          <Link to={`/browse/publisher/${encodeURIComponent(book.publisher)}`} state={linkState} className="hover:text-white transition-colors">
            {book.publisher}
          </Link>
        </Row>
      )}
      {book.series && (
        <Row label="Series">
          <Link to={`/browse/series/${encodeURIComponent(book.series)}`} state={linkState} className="hover:text-white transition-colors">
            {book.series}
          </Link>
          {book.series_number != null && (
            <span className="text-neutral-500 ml-1">· #{book.series_number}</span>
          )}
        </Row>
      )}
      {location && (
        <Row label="Location">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-neutral-400 text-xs">{locationCrumb(location)}</span>
            {location.building_id && (
              <Link
                to={`/shelf-view?b=${location.building_id}${location.room_id ? `&r=${location.room_id}` : ''}${location.unit_id ? `&u=${location.unit_id}` : ''}${location.shelf_id ? `&s=${location.shelf_id}` : ''}&focus=${book.id}`}
                className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
              >
                Reveal →
              </Link>
            )}
          </span>
        </Row>
      )}
      {(book.isbn_13 || book.isbn_10) && (
        <Row label="ISBN">{book.isbn_13 || book.isbn_10}</Row>
      )}
      {book.asin && (
        <Row label="ASIN">{book.asin}</Row>
      )}
      {(book.acquisition_source || book.acquisition_date) && (
        <Row label="Acquired">
          {[book.acquisition_source, formatPartialDate(book.acquisition_date)].filter(Boolean).join(' · ')}
        </Row>
      )}
      {/* Started/Finished show the *most recent* dates from the reads
          table when present, falling back to the book-column values
          during the Phase 2 transition. A re-read in 2025 should
          display 'Finished 2025-…' on the card, not the original
          first-finish date. Full per-read history lives in the READ
          HISTORY section further down the page. */}
      {(book.last_started || book.date_started) && (
        <Row label="Started">{formatPartialDate(book.last_started || book.date_started)}</Row>
      )}
      {(book.last_finished || book.date_finished) && (
        <Row label="Finished">{formatPartialDate(book.last_finished || book.date_finished)}</Row>
      )}
      {(() => {
        // Per-edition read_count is the canonical value (each edition owns
        // its own state per the 1.49.0 design). The cross-edition total is
        // a derived hint that surfaces when a linked-edition group exists,
        // so "I've read this work" reads true at the work level without
        // sacrificing the per-edition granularity. The row shows whenever
        // there's at least one read on this edition — hiding the "1" case
        // silently confused users who watched the row vanish when they
        // corrected 2 → 1 (2026-07-10 Broken Angels report).
        const own = book.read_count || 0;
        const siblingReads = (book.editions || []).reduce((s, e) => s + (e.read_count || 0), 0);
        const total = own + siblingReads;
        if (own < 1) return null;
        return (
          <Row label="Times read">
            {own}
            {siblingReads > 0 && (
              <span className="text-neutral-600 text-xs ml-2">· {total} across editions</span>
            )}
          </Row>
        );
      })()}
    </dl>
  );
}
