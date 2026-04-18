import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import StarRating from '../components/StarRating.jsx';

const STATUS_LABEL = { reading: 'Reading', paused: 'Paused', finished: 'Finished', unread: 'Unread' };
const STATUS_COLOR = {
  reading:  'text-parchment bg-oak/30',
  paused:   'text-neutral-300 bg-neutral-800',
  finished: 'text-leather bg-binding/30',
  unread:   'text-neutral-400 bg-neutral-800',
};

function ProgressSection({ book, onChange }) {
  const modeKey = `spine-progress-mode-${book.id}`;
  const [mode, setMode] = useState(() => localStorage.getItem(modeKey) || 'page');
  const [saving, setSaving] = useState(false);

  const pct = book.page_count && book.current_page
    ? Math.min(100, Math.round((book.current_page / book.page_count) * 100))
    : null;
  const hasPct = Boolean(book.page_count);

  const currentVal = mode === 'pct' ? (pct !== null ? String(pct) : '') : (book.current_page != null ? String(book.current_page) : '');
  const [inputVal, setInputVal] = useState(currentVal);

  function changeMode(m) {
    setMode(m);
    localStorage.setItem(modeKey, m);
    setInputVal(m === 'pct' ? (pct !== null ? String(pct) : '') : (book.current_page != null ? String(book.current_page) : ''));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (inputVal === '') return;
    setSaving(true);
    try {
      let current_page;
      if (mode === 'pct') {
        current_page = Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.page_count);
      } else {
        current_page = Math.max(0, parseInt(inputVal));
      }
      const updated = await api.patchBook(book.id, { current_page });
      onChange(updated);
      const newPct = updated.page_count && updated.current_page
        ? Math.min(100, Math.round((updated.current_page / updated.page_count) * 100))
        : null;
      setInputVal(mode === 'pct' ? (newPct !== null ? String(newPct) : '') : (updated.current_page != null ? String(updated.current_page) : ''));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-neutral-800 rounded-lg p-4 mb-6">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Reading progress</p>

      <div className="h-2 bg-neutral-800 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-oak rounded-full transition-all duration-300"
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>

      <p className="text-sm text-neutral-400 mb-4">
        {book.current_page
          ? hasPct
            ? `Page ${book.current_page} of ${book.page_count} · ${pct}%`
            : `Page ${book.current_page}`
          : 'No progress recorded yet'}
      </p>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <select
          value={mode}
          onChange={(e) => changeMode(e.target.value)}
          className="bg-neutral-900 border border-neutral-700 text-neutral-300 text-sm rounded px-2 py-1.5 focus:outline-none"
        >
          <option value="page">Page</option>
          {hasPct && <option value="pct">Percent</option>}
        </select>
        <input
          type="number"
          min="0"
          max={mode === 'pct' ? 100 : (book.page_count || undefined)}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder={mode === 'pct' ? 'e.g. 42' : 'e.g. 123'}
          className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors"
        />
        <button
          type="submit"
          disabled={saving || inputVal === ''}
          className="text-sm bg-binding hover:bg-binding/80 active:scale-[0.98] disabled:opacity-40 disabled:cursor-default text-parchment px-4 py-1.5 rounded transition-[transform,background-color] ease-out duration-150"
        >
          {saving ? 'Saving…' : 'Update'}
        </button>
      </form>
    </div>
  );
}

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBook(id).then(setBook).finally(() => setLoading(false));
  }, [id]);

  async function handleDelete() {
    if (!confirm(`Delete "${book.title}"?`)) return;
    await api.deleteBook(id);
    navigate('/');
  }

  if (loading) return <div className="text-neutral-700 text-sm">Loading…</div>;
  if (!book) return <div className="text-neutral-600 text-sm">Book not found.</div>;

  return (
    <div className="max-w-2xl">
      <Link to="/" className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        ← Library
      </Link>

      <div className="flex gap-8 sm:gap-10">
        <div className="w-36 sm:w-44 flex-shrink-0">
          <div className="aspect-[2/3] bg-neutral-800 rounded overflow-hidden shadow-2xl ring-1 ring-white/5">
            {book.cover_path ? (
              <img src={book.cover_path} alt={book.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-end p-3 bg-gradient-to-br from-neutral-700 to-neutral-900">
                <span className="text-xs text-neutral-400 font-medium leading-tight">{book.title}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-1">
          <h1 className="text-2xl font-bold text-white leading-tight mb-1">{book.title}</h1>
          {book.author && (
            <p className="text-neutral-400 text-base mb-5">
              <Link to={`/browse/author/${encodeURIComponent(book.author)}`} className="hover:text-neutral-200 transition-colors">
                {book.author}
              </Link>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[book.status]}`}>
              {STATUS_LABEL[book.status]}
            </span>
            {Boolean(book.owned) && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full text-parchment bg-binding/60">
                Owned
              </span>
            )}
            {Boolean(book.is_custom) && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full text-leather bg-neutral-800">
                ✦ Custom
              </span>
            )}
            {book.rating && <StarRating value={book.rating} readOnly />}
          </div>

          {(book.status === 'reading' || book.status === 'paused') && (
            <ProgressSection book={book} onChange={setBook} />
          )}

          <dl className="space-y-2.5 text-sm mb-6">
            {book.format && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Format</dt>
                <dd className="text-neutral-300 capitalize">
                  {book.format === 'ebook' ? 'E-book' : book.format.charAt(0).toUpperCase() + book.format.slice(1)}
                  {book.binding && ` — ${book.binding.charAt(0).toUpperCase() + book.binding.slice(1)}`}
                  {book.condition && ` (${book.condition})`}
                </dd>
              </div>
            )}
            {book.page_count && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Pages</dt>
                <dd className="text-neutral-300">{book.page_count}</dd>
              </div>
            )}
            {book.duration_minutes && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Duration</dt>
                <dd className="text-neutral-300">
                  {Math.floor(book.duration_minutes / 60)}h {book.duration_minutes % 60}m
                </dd>
              </div>
            )}
            {book.publisher && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Publisher</dt>
                <dd className="text-neutral-300">
                  <Link to={`/browse/publisher/${encodeURIComponent(book.publisher)}`} className="hover:text-white transition-colors">
                    {book.publisher}
                  </Link>
                </dd>
              </div>
            )}
            {book.series && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Series</dt>
                <dd className="text-neutral-300">
                  <Link to={`/browse/series/${encodeURIComponent(book.series)}`} className="hover:text-white transition-colors">
                    {book.series}
                  </Link>
                </dd>
              </div>
            )}
            {Boolean(book.owned) && (book.shelf_room || book.shelf_unit || book.shelf_number) && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Location</dt>
                <dd className="text-neutral-300">
                  {[book.shelf_room, book.shelf_unit, book.shelf_number ? `Shelf ${book.shelf_number}` : null].filter(Boolean).join(' · ')}
                </dd>
              </div>
            )}
            {(book.isbn_13 || book.isbn_10) && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">ISBN</dt>
                <dd className="text-neutral-300">{book.isbn_13 || book.isbn_10}</dd>
              </div>
            )}
            {(book.acquisition_source || book.acquisition_date) && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Acquired</dt>
                <dd className="text-neutral-300">
                  {[book.acquisition_source, book.acquisition_date].filter(Boolean).join(' · ')}
                </dd>
              </div>
            )}
            {book.date_started && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Started</dt>
                <dd className="text-neutral-300">{book.date_started}</dd>
              </div>
            )}
            {book.date_finished && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Finished</dt>
                <dd className="text-neutral-300">{book.date_finished}</dd>
              </div>
            )}
          </dl>

          {book.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {book.tags.map((t) => (
                <Link key={t.id} to={`/browse/tag/${encodeURIComponent(t.name)}`} className="text-xs bg-neutral-800 text-neutral-400 px-2.5 py-1 rounded-full hover:bg-neutral-700 hover:text-neutral-200 transition-colors">
                  {t.name}
                </Link>
              ))}
            </div>
          )}

          {book.description && (
            <div className="border-t border-neutral-800 pt-5 mb-5">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Description</p>
              <p className="text-neutral-400 text-sm leading-relaxed whitespace-pre-wrap">{book.description}</p>
            </div>
          )}

          {book.notes && (
            <div className={book.description ? '' : 'border-t border-neutral-800 pt-5'}>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Notes</p>
              <p className="text-neutral-400 text-sm leading-relaxed whitespace-pre-wrap">{book.notes}</p>
            </div>
          )}

          <div className="flex gap-3 mt-8 pt-6 border-t border-neutral-800/60">
            <Link
              to={`/books/${book.id}/edit`}
              className="text-sm bg-neutral-800 hover:bg-neutral-700 active:scale-[0.98] text-white px-5 py-2 rounded transition-[transform,background-color] ease-out duration-150"
            >
              Edit
            </Link>
            <button
              onClick={handleDelete}
              className="text-sm text-neutral-600 hover:text-warn px-4 py-2 rounded transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
