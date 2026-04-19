import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

const SORTS = [
  { key: 'added',  label: 'Date added' },
  { key: 'title',  label: 'Title A–Z' },
  { key: 'author', label: 'Author A–Z' },
  { key: 'rating', label: 'Rating' },
];

function applySort(books, sort) {
  const b = [...books];
  if (sort === 'title')  return b.sort((a, z) => a.title.localeCompare(z.title));
  if (sort === 'author') return b.sort((a, z) => (a.author || '').localeCompare(z.author || ''));
  if (sort === 'rating') return b.sort((a, z) => (z.rating ?? 0) - (a.rating ?? 0));
  return b; // 'added' — already ordered by added_at DESC from server
}

function Stars({ rating }) {
  if (!rating) return null;
  return (
    <span className="text-xs text-oak tracking-tight flex-shrink-0">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
  );
}

function BookRow({ book }) {
  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-neutral-900 border border-neutral-800">
      <div className="w-9 h-[54px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {book.cover_path ? (
          <img src={book.cover_path} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <Link to={`/books/${book.id}`} className="text-sm font-medium text-neutral-200 hover:text-white transition-colors truncate block">
          {book.title}
        </Link>
        <p className="text-xs text-neutral-500 truncate mt-0.5">
          {[book.author, book.series && `${book.series}${book.series_number ? ` #${book.series_number}` : ''}`].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="flex-shrink-0 flex items-center gap-4">
        <Stars rating={book.rating} />
        {book.format && book.format !== 'physical' && (
          <span className="text-xs text-neutral-600 capitalize hidden md:block">{book.format}</span>
        )}
        {book.owned ? (
          <span className="text-xs text-emerald-700 hidden sm:block">owned</span>
        ) : (
          <span className="text-xs text-neutral-700 hidden sm:block">unowned</span>
        )}
      </div>
    </div>
  );
}

export default function ListDetail() {
  const { id } = useParams();
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('added');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);

  useEffect(() => {
    api.getList(id)
      .then(setList)
      .catch(() => setError('Failed to load list.'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleRename(e) {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name || name === list.name) { setRenaming(false); return; }
    try {
      const updated = await api.renameList(id, name);
      setList(l => ({ ...l, name: updated.name }));
      setRenaming(false);
      setRenameError(null);
    } catch (err) {
      setRenameError(err.message);
    }
  }

  if (loading) return <div className="text-neutral-700 text-sm">Loading…</div>;
  if (error)   return <div className="text-red-500 text-sm">{error}</div>;

  const sorted = applySort(list.books, sort);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/lists" className="text-neutral-600 hover:text-neutral-400 transition-colors text-sm">
          ← Lists
        </Link>
        <span className="text-neutral-700">/</span>
        {renaming ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={handleRename}
              className="bg-neutral-800 border border-neutral-700 rounded px-3 py-1 text-lg font-bold text-white focus:outline-none focus:border-oak/50"
            />
            {renameError && <span className="text-xs text-red-400">{renameError}</span>}
          </form>
        ) : (
          <h1
            className="text-xl font-bold text-white cursor-pointer hover:text-neutral-300 transition-colors"
            title="Click to rename"
            onClick={() => { setRenameValue(list.name); setRenaming(true); }}
          >
            {list.name}
          </h1>
        )}
        <span className="text-xs text-neutral-600 mt-0.5">{list.books.length} {list.books.length === 1 ? 'book' : 'books'}</span>
      </div>

      {list.books.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">This list is empty.</p>
          <Link to="/" className="text-sm text-oak hover:text-leather">
            Browse your library →
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-end mb-3">
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 transition-colors"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            {sorted.map(book => (
              <BookRow key={book.id} book={book} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
