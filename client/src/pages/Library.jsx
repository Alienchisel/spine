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
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getBooks(tab === 'all' ? null : tab).then(setBooks).finally(() => setLoading(false));
  }, [tab]);

  const filtered = query.trim()
    ? books.filter(b =>
        b.title.toLowerCase().includes(query.toLowerCase()) ||
        (b.author && b.author.toLowerCase().includes(query.toLowerCase()))
      )
    : books;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
        <div className="flex gap-1 bg-neutral-900 p-1 rounded-lg w-fit">
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

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or author…"
          className="bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors w-full sm:w-64"
        />
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-32">
          {query ? (
            <p className="text-neutral-600">No books match &ldquo;{query}&rdquo;</p>
          ) : (
            <>
              <p className="text-neutral-600 mb-3">Nothing here yet.</p>
              <Link to="/books/new" className="text-sm text-amber-500 hover:text-amber-400">
                Add your first book →
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-4 gap-y-7">
          {filtered.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}
    </div>
  );
}
