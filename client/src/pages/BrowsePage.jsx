import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';
import { useGridCols } from '../hooks/useGridCols.js';

const BROWSE_BPS = [{ minWidth: 0, cols: 3 }, { minWidth: 640, cols: 4 }, { minWidth: 768, cols: 5 }];

const FIELD_LABEL = {
  author: 'Author', translator: 'Translator', publisher: 'Publisher',
  series: 'Series', tag: 'Tag', fiction: '', format: '', language: 'Language',
  narrator: 'Narrator', rating: 'Rating', year_finished: 'Finished',
};

const FORMAT_LABEL = { physical: 'Physical', ebook: 'Digital', audiobook: 'Audiobook' };

function starsLabel(r) {
  const full = Math.floor(r);
  const half = r % 1 !== 0;
  return '★'.repeat(full) + (half ? '½' : '');
}

function browseSort(field) {
  if (field === 'series')       return 'series_order';
  if (field === 'year_finished') return 'finished';
  return 'title';
}

const PAGE_SIZE = 48;

export default function BrowsePage() {
  const { field, value } = useParams();
  const decoded = decodeURIComponent(value);
  const { state } = useLocation();
  const backLabel = state?.from ? `← ${state.from}` : '← Library';
  const backPath  = state?.fromPath ?? '/';

  const [books,       setBooks]       = useState([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadedRef = useRef(0);
  const gridCols  = useGridCols(BROWSE_BPS);

  useEffect(() => {
    setLoading(true);
    setBooks([]);
    loadedRef.current = 0;
    api.getBooks({ field, value: decoded, sort: browseSort(field), limit: PAGE_SIZE, offset: 0 })
      .then(({ books: b, total: t }) => {
        setBooks(b);
        setTotal(t);
        loadedRef.current = b.length;
      }).finally(() => setLoading(false));
  }, [field, decoded]);

  function handleLoadMore() {
    setLoadingMore(true);
    api.getBooks({ field, value: decoded, sort: browseSort(field), limit: PAGE_SIZE, offset: loadedRef.current })
      .then(({ books: b, total: t }) => {
        setBooks(prev => [...prev, ...b]);
        setTotal(t);
        loadedRef.current += b.length;
      }).finally(() => setLoadingMore(false));
  }

  const label = FIELD_LABEL[field] ?? field;
  const heading = field === 'fiction'
    ? (decoded === 'fiction' ? 'Fiction' : decoded === 'nonfiction' ? 'Non-fiction' : 'Fiction / NF unset')
    : field === 'format'        ? (FORMAT_LABEL[decoded] ?? decoded)
    : field === 'rating'        ? starsLabel(parseFloat(decoded))
    : field === 'year_finished' ? decoded
    : decoded;

  const hasMore = loadedRef.current < total;

  return (
    <div>
      <Link to={backPath} className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        {backLabel}
      </Link>
      <div className="mb-8">
        {label && <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">{label}</p>}
        <h1 className="text-2xl font-bold text-white">{heading}</h1>
        {!loading && <p className="text-sm text-neutral-500 mt-1">{total} {total === 1 ? 'book' : 'books'}</p>}
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : books.length === 0 ? (
        <div className="text-neutral-600 text-sm">No books found.</div>
      ) : (() => {
        // Mid-pagination, hide trailing partial-row books; reveal on next load.
        const trim = hasMore && gridCols > 0 ? books.length % gridCols : 0;
        const visible = trim > 0 ? books.slice(0, -trim) : books;
        const padCount = !hasMore && gridCols > 0 ? (gridCols - visible.length % gridCols) % gridCols : 0;
        return (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7">
            {visible.map(book => <BookCard key={book.id} book={book} />)}
            {Array.from({ length: padCount }).map((_, i) => (
              <div
                key={`pad-${i}`}
                aria-hidden="true"
                className="aspect-[2/3] rounded bg-neutral-900/70 ring-1 ring-neutral-800/60"
              />
            ))}
          </div>
        );
      })()}
      {hasMore && (
        <div className="mt-10 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
          >
            {loadingMore ? 'Loading…' : `Load more · ${total - loadedRef.current} remaining`}
          </button>
        </div>
      )}
    </div>
  );
}

