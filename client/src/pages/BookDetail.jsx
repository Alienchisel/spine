import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import StarRating from '../components/StarRating.jsx';

const STATUS_LABEL = { reading: 'Reading', finished: 'Finished' };
const STATUS_COLOR = {
  reading: 'text-emerald-400 bg-emerald-950/60',
  finished: 'text-sky-400 bg-sky-950/60',
};

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
            <p className="text-neutral-400 text-base mb-5">{book.author}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[book.status]}`}>
              {STATUS_LABEL[book.status]}
            </span>
            {Boolean(book.owned) && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full text-amber-400 bg-amber-950/50">
                Owned
              </span>
            )}
            {book.rating && <StarRating value={book.rating} readOnly />}
          </div>

          <dl className="space-y-2.5 text-sm mb-6">
            {book.acquisition_source && (
              <div className="flex gap-2">
                <dt className="text-neutral-500 w-24 flex-shrink-0">Acquired</dt>
                <dd className="text-neutral-300">{book.acquisition_source}</dd>
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
                <span key={t.id} className="text-xs bg-neutral-800 text-neutral-400 px-2.5 py-1 rounded-full">
                  {t.name}
                </span>
              ))}
            </div>
          )}

          {book.notes && (
            <p className="text-neutral-400 text-sm leading-relaxed border-t border-neutral-800 pt-5 whitespace-pre-wrap">
              {book.notes}
            </p>
          )}

          <div className="flex gap-3 mt-8 pt-6 border-t border-neutral-800/60">
            <Link
              to={`/books/${book.id}/edit`}
              className="text-sm bg-neutral-800 hover:bg-neutral-700 text-white px-5 py-2 rounded transition-colors"
            >
              Edit
            </Link>
            <button
              onClick={handleDelete}
              className="text-sm text-neutral-600 hover:text-red-400 px-4 py-2 rounded transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
