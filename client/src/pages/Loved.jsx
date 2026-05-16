import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';
import CoverSizeSlider from '../components/CoverSizeSlider.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useCoverSize } from '../hooks/useCoverSize.js';

const FROM_LOVED = { from: 'Loved', fromPath: '/loved' };

export default function Loved() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshTick = useRefreshTick();
  const { size: coverSize, setSize: setCoverSize, compact, gridStyle, gridClassName, MIN: coverMin, MAX: coverMax } = useCoverSize();

  useEffect(() => {
    let stale = false;
    api.getBooks({ tab: 'loved' })
      .then(({ books }) => { if (!stale) { setBooks(books); setError(null); } })
      .catch(() => { if (!stale) setError('Failed to load loved books.'); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [refreshTick]);

  function handleUpdate(updated) {
    // Loved sorts by updated_at DESC (no UI selector). Splice the updated book
    // to the top so inline edits bump it right away, matching the server's
    // ordering on next mount.
    if (!updated.loved) {
      setBooks(bs => bs.filter(b => b.id !== updated.id));
    } else {
      setBooks(bs => [updated, ...bs.filter(b => b.id !== updated.id)]);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Loved</h1>
        {books.length > 0 && (
          <CoverSizeSlider size={coverSize} onChange={setCoverSize} min={coverMin} max={coverMax} />
        )}
      </div>

      {/* First-load failure (no data) replaces the view; refresh-tick
          failure on an already-loaded page surfaces as a dismissible
          banner above the existing books. Mirrors Stats / Diary. */}
      {books.length > 0 && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : books.length === 0 && error ? (
        <div role="alert" className="text-red-500 text-sm">{error}</div>
      ) : books.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">No loved books yet.</p>
          <Link to="/" className="text-sm text-oak hover:text-leather">
            Browse your library →
          </Link>
        </div>
      ) : (
        <div className={gridClassName} style={gridStyle}>
          {books.map(book => (
            <BookCard key={book.id} book={book} onProgressUpdate={handleUpdate} compact={compact} linkState={FROM_LOVED} />
          ))}
        </div>
      )}
    </div>
  );
}
