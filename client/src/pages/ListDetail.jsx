import { useState, useEffect, useRef } from 'react';
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
  return b;
}

function Stars({ rating }) {
  if (!rating) return null;
  const full = Math.floor(rating);
  const half = rating % 1 !== 0;
  return (
    <span className="text-xs text-oak tracking-tight flex-shrink-0">
      {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))}
    </span>
  );
}

function BookRow({ book, onRemove }) {
  return (
    <div className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${book.is_stub ? 'bg-neutral-900/50 border-neutral-800/50' : 'bg-neutral-900 border-neutral-800'}`}>
      <div className="w-9 h-[54px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {book.cover_path ? (
          <img src={book.cover_path} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link to={`/books/${book.id}`} className={`text-sm font-medium hover:text-white transition-colors truncate block ${book.is_stub ? 'text-neutral-400' : 'text-neutral-200'}`}>
            {book.title}
          </Link>
          {Boolean(book.is_stub) && (
            <span className="flex-shrink-0 text-xs text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5 leading-none">
              incomplete
            </span>
          )}
        </div>
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
        {onRemove && (
          <button
            onClick={() => onRemove(book.id)}
            className="text-neutral-700 hover:text-red-400 transition-colors text-lg leading-none"
            title="Remove from list"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function QuickAdd({ listId, onAdded }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const book = await api.createBook({ title: title.trim(), author: author.trim() || undefined, is_stub: true });
      await api.addToList(listId, book.id);
      onAdded(book);
      setTitle('');
      setAuthor('');
      setExpanded(false);
      titleRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 mb-6">
      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onFocus={() => setExpanded(true)}
        placeholder="Quick-add a book by title…"
        className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 transition-colors flex-1"
      />
      {expanded && (
        <input
          type="text"
          value={author}
          onChange={e => setAuthor(e.target.value)}
          placeholder="Author (optional)"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 transition-colors w-48"
        />
      )}
      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="text-sm font-medium bg-oak hover:bg-leather disabled:opacity-40 active:scale-[0.98] text-neutral-950 px-4 py-2 rounded-lg transition-[transform,background-color] ease-out duration-150 whitespace-nowrap"
      >
        Add
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
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

  function handleAdded(book) {
    setList(l => ({ ...l, books: [{ ...book, added_at: new Date().toISOString() }, ...l.books] }));
  }

  async function handleRemove(bookId) {
    await api.removeFromList(id, bookId);
    setList(l => ({ ...l, books: l.books.filter(b => b.id !== bookId) }));
  }

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

      <QuickAdd listId={id} onAdded={handleAdded} />

      {list.books.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-neutral-600">This list is empty. Add a book above.</p>
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
              <BookRow key={book.id} book={book} onRemove={handleRemove} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
