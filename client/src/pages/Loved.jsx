import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

const FROM_LOVED = { from: 'Loved', fromPath: '/loved' };

export default function Loved() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshTick = useRefreshTick();

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
      <h1 className="text-xl font-bold text-white mb-6">Loved</h1>

      {/* First-load failure (no data) replaces the view; refresh-tick
          failure on an already-loaded page surfaces as a dismissible
          banner above the existing books. Mirrors Stats / Diary. */}
      {error && books.length > 0 && (
        <div className="flex items-center justify-between bg-warn/10 border border-warn/30 rounded px-3 py-2 mb-4">
          <p role="alert" className="text-xs text-warn">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-warn/60 hover:text-warn ml-4">×</button>
        </div>
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
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5">
          {books.map(book => (
            <BookCard key={book.id} book={book} onProgressUpdate={handleUpdate} linkState={FROM_LOVED} />
          ))}
        </div>
      )}
    </div>
  );
}
