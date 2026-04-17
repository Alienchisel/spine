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

const FORMATS = [
  { key: 'physical', label: 'Physical' },
  { key: 'ebook', label: 'E-book' },
  { key: 'audiobook', label: 'Audiobook' },
];

export default function Library() {
  const [tab, setTab] = useState('reading');
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [formats, setFormats] = useState([]);
  const [ownedOnly, setOwnedOnly] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getBooks(tab === 'all' ? null : tab).then(setBooks).finally(() => setLoading(false));
  }, [tab]);

  function toggleFormat(key) {
    setFormats(f => f.includes(key) ? f.filter(k => k !== key) : [...f, key]);
  }

  const filtered = books.filter(b => {
    if (query.trim() && !(
      b.title.toLowerCase().includes(query.toLowerCase()) ||
      (b.author && b.author.toLowerCase().includes(query.toLowerCase()))
    )) return false;
    if (formats.length > 0 && !formats.includes(b.format)) return false;
    if (ownedOnly && !b.owned) return false;
    return true;
  });

  const hasActiveFilters = formats.length > 0 || ownedOnly;

  return (
    <div>
      <div className="flex flex-col gap-3 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
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

        <div className="flex flex-wrap items-center gap-2">
          {FORMATS.map(f => (
            <button
              key={f.key}
              onClick={() => toggleFormat(f.key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                formats.includes(f.key)
                  ? 'bg-neutral-200 text-black border-neutral-200'
                  : 'border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-500'
              }`}
            >
              {f.label}
            </button>
          ))}

          <button
            onClick={() => setOwnedOnly(o => !o)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              ownedOnly
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-500'
            }`}
          >
            Owned
          </button>

          {hasActiveFilters && (
            <button
              onClick={() => { setFormats([]); setOwnedOnly(false); }}
              className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors ml-1"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-32">
          {query || hasActiveFilters ? (
            <p className="text-neutral-600">No books match the current filters.</p>
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
            <BookCard
              key={book.id}
              book={book}
              onProgressUpdate={(updated) => setBooks(bs => bs.map(b => b.id === updated.id ? updated : b))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
