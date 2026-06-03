import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { initialsFor, plural } from '../utils.js';

// Surfaces the reflective layer — user-authored prose (review + notes)
// across the library — as a first-class destination, instead of leaving
// it buried per-book on BookDetail's right rail.
//
// v1: recently-edited rows, no search / no tag filter / no per-tab
// split. Iterate from here once the surface starts pulling its own
// weight.

// Strip basic markdown so a preview reads as plain prose. Cheap
// regex pass — not a full parser, just enough to take out asterisks,
// underscores, link syntax, and `#NNN` book-ref markdown the user
// inserts via the @-picker so the preview line doesn't carry it.
function stripMarkdown(s) {
  if (!s) return '';
  return s
    .replace(/\[([^\]]+)\]\(spine-book:\d+\)/g, '$1')   // book-ref links → label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')            // any markdown link → label
    .replace(/[*_`~]/g, '')                              // emphasis / inline code marks
    .replace(/\s+/g, ' ')                                // collapse whitespace
    .trim();
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Notes() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getBooks({ has_writing: 1, sort: 'updated', limit: 200 })
      .then(d => { if (!cancelled) setBooks(d.books || []); })
      .catch(() => { if (!cancelled) setError('Failed to load notes.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-5xl">
      <h1 className="font-slab text-3xl text-parchment mb-1">Notes</h1>
      <p className="text-sm text-neutral-500 mb-8">
        Reviews and notes you've written, most recent first.
      </p>

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <p role="alert" className="text-sm text-warn">{error}</p>
      ) : books.length === 0 ? (
        <p className="text-neutral-600">No notes or reviews written yet.</p>
      ) : (
        <>
          <p className="text-xs text-neutral-600 mb-3">{plural(books.length, 'book')} with writing</p>
          <ul className="divide-y divide-neutral-800">
            {books.map(book => {
              // Prefer review (more formal, longer-lived) when both
              // exist; fall back to notes. The badge tells the user
              // which one is being previewed.
              const hasReview = book.review && book.review.trim();
              const hasNotes  = book.notes  && book.notes.trim();
              const primary   = hasReview ? book.review : book.notes;
              const primaryKind = hasReview ? 'Review' : 'Notes';
              const alsoHasOther = hasReview && hasNotes;
              const authorByline = (book.authors || []).map(a => a.name).join(', ');
              return (
                <li key={book.id}>
                  <Link
                    to={`/books/${book.id}`}
                    state={{ from: 'Notes', fromPath: '/notes' }}
                    className="flex gap-4 py-4 group focus:outline-none focus-visible:bg-neutral-900/40 -mx-2 px-2 rounded transition-colors"
                  >
                    {/* Thumbnail — small, just enough to anchor the row
                        to a book. Falls back to initials if no cover. */}
                    <div className="flex-shrink-0 w-12 h-16 rounded-sm bg-neutral-800 overflow-hidden">
                      {book.cover_path ? (
                        <img src={book.cover_path} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-neutral-500 font-medium tracking-wide bg-gradient-to-br from-neutral-700 to-neutral-900">
                          {initialsFor(book.title)}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-sm font-medium text-parchment group-hover:text-leather transition-colors truncate">
                          {book.title}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-neutral-600 flex-shrink-0">
                          {primaryKind}
                        </span>
                        {alsoHasOther && (
                          <span className="text-[10px] text-neutral-700 flex-shrink-0">+ notes</span>
                        )}
                      </div>
                      {authorByline && (
                        <p className="text-xs text-neutral-500 mb-1.5 truncate">{authorByline}</p>
                      )}
                      <p className="text-sm text-neutral-400 line-clamp-2 whitespace-pre-line">
                        {stripMarkdown(primary)}
                      </p>
                    </div>

                    <div className="flex-shrink-0 text-xs text-neutral-600 tabular-nums">
                      {formatDate(book.updated_at)}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
