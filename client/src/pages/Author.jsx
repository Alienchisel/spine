import { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';

// Author entity page: lists all books bylined under this specific
// author plus an "also writes as" section linking to alias siblings.
// Distinct from /browse/author/:name which is a name-based filter view —
// the entity page is id-based (stable across renames) and surfaces the
// aliases that the filter view can't.
export default function Author() {
  const { id }       = useParams();
  const { state, pathname } = useLocation();
  const backLabel    = state?.from ? `← ${state.from}` : '← Library';
  const backPath     = state?.fromPath ?? '/';

  const [author, setAuthor] = useState(null);
  const [loading, setLoading] = useState(true);
  // 'notfound' for a 404 (author id has no row), 'fetch' for any other
  // failure. Distinguished so the body can show a tailored message
  // instead of conflating "this author doesn't exist" with "the request
  // failed — please retry".
  const [errorKind, setErrorKind] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorKind(null);
    api.getAuthor(id)
      .then(data => { if (!cancelled) setAuthor(data); })
      .catch(err => {
        if (cancelled) return;
        setErrorKind(err?.status === 404 ? 'notfound' : 'fetch');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const fromState = useMemo(
    () => ({ from: author?.name, fromPath: pathname }),
    [author?.name, pathname],
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <Link to={backPath} state={state} className="text-sm text-neutral-500 hover:text-neutral-200 transition-colors">
        {backLabel}
      </Link>

      <div className="mt-6 mb-8">
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Author</p>
        <h1 className="text-2xl font-bold text-white">{author?.name ?? (loading || errorKind === 'fetch' ? ' ' : 'Author not found')}</h1>
        {author?.aliases?.length > 0 && (
          <p className="text-neutral-600 text-xs mt-1">
            also writes as{' '}
            {author.aliases.map((a, i) => (
              <span key={a.id}>
                {i > 0 && (i === author.aliases.length - 1 ? ' & ' : ', ')}
                <Link to={`/authors/${a.id}`} state={fromState} className="hover:text-neutral-400 transition-colors">
                  {a.name}
                </Link>
              </span>
            ))}
          </p>
        )}
        {!loading && author && (
          <p className="text-sm text-neutral-500 mt-1">{author.total} {author.total === 1 ? 'book' : 'books'}</p>
        )}
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : errorKind === 'fetch' ? (
        <div className="text-center py-32">
          <p className="text-neutral-600">Failed to load author. Please try again.</p>
        </div>
      ) : errorKind === 'notfound' ? null
      : !author?.books?.length ? (
        <div className="text-neutral-600 text-sm">No books found.</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5 items-start">
          {author.books.map(book => <BookCard key={book.id} book={book} linkState={fromState} />)}
        </div>
      )}
    </div>
  );
}
