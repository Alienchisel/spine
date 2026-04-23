import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';

export default function Loved() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getLovedBooks()
      .then(setBooks)
      .catch(() => setError('Failed to load loved books.'))
      .finally(() => setLoading(false));
  }, []);

  function handleUpdate(updated) {
    setBooks(bs => bs.map(b => b.id === updated.id ? updated : b).filter(b => b.loved));
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-6">Loved</h1>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <div className="text-red-500 text-sm">{error}</div>
      ) : books.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">No loved books yet.</p>
          <Link to="/" className="text-sm text-oak hover:text-leather">
            Browse your library →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7">
          {books.map(book => (
            <BookCard key={book.id} book={book} onProgressUpdate={handleUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}
