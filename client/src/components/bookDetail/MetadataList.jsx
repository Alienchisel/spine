import { Link } from 'react-router-dom';
import { formatDate, formatPartialDate } from './dates.js';

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

export default function MetadataList({ book, location }) {
  return (
    <dl className="space-y-2.5 text-sm mb-6">
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
            {(Boolean(book.owned) || Boolean(book.previously_owned)) && book.condition && ` (${book.condition.replace(/\b\w/g, c => c.toUpperCase())})`}
          </span>
        </Row>
      )}
      {book.narrators?.length > 0 && (
        <Row label={book.narrators.length === 1 ? 'Narrator' : 'Narrators'}>
          {book.narrators.map((n, i) => (
            <span key={n.id}>
              {i > 0 && <span className="text-neutral-600">, </span>}
              <Link to={`/browse/narrator/${encodeURIComponent(n.name)}`} className="hover:text-white transition-colors">
                {n.name}
              </Link>
            </span>
          ))}
        </Row>
      )}
      {book.year_published && (
        <Row label="Published">
          {book.year_published}
          {book.year_edition && book.year_edition !== book.year_published
            ? ` (this edition ${book.year_approximate ? 'ca. ' : ''}${book.year_edition})`
            : ''}
        </Row>
      )}
      {!book.year_published && book.year_edition && (
        <Row label="Edition">{book.year_approximate ? `ca. ${book.year_edition}` : book.year_edition}</Row>
      )}
      {book.format === 'audiobook' && book.duration_minutes > 0 && (
        <Row label="Length">
          {(() => { const h = Math.floor(book.duration_minutes / 60), m = book.duration_minutes % 60; return h > 0 ? `${h}h ${m}m` : `${m}m`; })()}
        </Row>
      )}
      {book.format !== 'audiobook' && book.page_count > 0 && (
        <Row label="Length">{book.page_count} pages</Row>
      )}
      {Boolean(book.abridged) && (
        <Row label="Edition">Abridged</Row>
      )}
      {book.language && book.language !== 'English' && (
        <Row label="Language">{book.language}</Row>
      )}
      {book.original_language && (
        <Row label="Original">{book.original_language}</Row>
      )}
      {book.translator && (
        <Row label="Translator">
          <Link to={`/browse/translator/${encodeURIComponent(book.translator)}`} className="hover:text-white transition-colors">
            {book.translator}
          </Link>
        </Row>
      )}
      {book.publisher && (
        <Row label="Publisher">
          <Link to={`/browse/publisher/${encodeURIComponent(book.publisher)}`} className="hover:text-white transition-colors">
            {book.publisher}
          </Link>
        </Row>
      )}
      {book.series && (
        <Row label="Series">
          <Link to={`/browse/series/${encodeURIComponent(book.series)}`} className="hover:text-white transition-colors">
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
                to={`/shelf-view?b=${location.building_id}${location.room_id ? `&r=${location.room_id}` : ''}${location.unit_id ? `&u=${location.unit_id}` : ''}${location.shelf_id ? `&s=${location.shelf_id}` : ''}`}
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
      {book.date_started && (
        <Row label="Started">{formatDate(book.date_started)}</Row>
      )}
      {book.date_finished && (
        <Row label="Finished">{formatDate(book.date_finished)}</Row>
      )}
      {book.read_count > 1 && (
        <Row label="Times read">{book.read_count}</Row>
      )}
    </dl>
  );
}
