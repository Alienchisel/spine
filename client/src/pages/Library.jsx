import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';

const TABS = [
  { key: 'reading', label: 'Reading' },
  { key: 'finished', label: 'Finished' },
  { key: 'unread', label: 'Unread' },
  { key: 'all', label: 'All' },
];

export default function Library() {
  const [tab, setTab] = useState('reading');
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getBooks(tab === 'all' ? null : tab).then(setBooks).finally(() => setLoading(false));
  }, [tab]);

  return (
    <div>
      <div className="flex gap-1 mb-10 bg-neutral-900 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t.key
                ? 'bg-white text-black'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : books.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">Nothing here yet.</p>
          <Link to="/books/new" className="text-sm text-amber-500 hover:text-amber-400">
            Add your first book →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-4 gap-y-7">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}
    </div>
  );
}
