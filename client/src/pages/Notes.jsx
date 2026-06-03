import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { initialsFor, plural } from '../utils.js';

// Surfaces the reflective layer — user-authored prose (review + notes)
// across the library — as a first-class destination, instead of leaving
// it buried per-book on BookDetail's right rail.
//
// v2 adds client-side search across the prose. The corpus is small
// (low hundreds of books at most), so filtering in memory is instant
// and lets us do snippet-around-match + inline highlight cleanly. If
// the corpus grows past a few thousand books with writing the cost
// would shift to backend FTS5, but that's a long way off.

// Strip basic markdown so a preview reads as plain prose. Cheap regex
// pass — not a full parser, just enough to take out asterisks,
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

// Extract a window of plain text around the first match of `q`. When
// there's no query (or no match), returns the leading chars so the row
// shows its standard opening preview. Adds ellipsis on the side that
// was truncated. Returns the offset within the snippet where the match
// starts, so the caller can wrap it in <mark> without rescanning.
const SNIPPET_LEN = 220;
function snippet(rawText, q) {
  const text = stripMarkdown(rawText);
  if (!q) return { text: text.slice(0, SNIPPET_LEN), matchStart: -1, matchLen: 0 };
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return { text: text.slice(0, SNIPPET_LEN), matchStart: -1, matchLen: 0 };
  // Roughly half the window before the match, the rest after. Bias
  // toward more context AFTER the match since the eye reads forward
  // from the highlight.
  const beforeBudget = Math.floor((SNIPPET_LEN - q.length) / 3);
  const start = Math.max(0, idx - beforeBudget);
  const end = Math.min(text.length, start + SNIPPET_LEN);
  const slice = text.slice(start, end);
  const leadEllipsis = start > 0 ? '…' : '';
  const tailEllipsis = end < text.length ? '…' : '';
  return {
    text: leadEllipsis + slice + tailEllipsis,
    matchStart: (idx - start) + leadEllipsis.length,
    matchLen: q.length,
  };
}

// Wrap the matched substring in <mark>. Quiet styling (oak/30 bg, no
// yellow) so the highlight reads as a soft underline of "this part"
// rather than as a callout. Returns a React fragment.
function highlight(text, matchStart, matchLen) {
  if (matchStart < 0 || matchLen === 0) return text;
  return (
    <>
      {text.slice(0, matchStart)}
      <mark className="bg-oak/30 text-parchment rounded px-0.5">
        {text.slice(matchStart, matchStart + matchLen)}
      </mark>
      {text.slice(matchStart + matchLen)}
    </>
  );
}

// Pick which field's text to preview, based on which one contains the
// active query (so the preview surfaces the matched passage instead of
// the canonical "review wins" fallback). When there's no query, prefer
// review (more formal) over notes.
function selectPrimary(book, q) {
  const hasReview = book.review && book.review.trim();
  const hasNotes  = book.notes  && book.notes.trim();
  if (q) {
    const ql = q.toLowerCase();
    if (hasReview && book.review.toLowerCase().includes(ql)) {
      return { text: book.review, kind: 'Review', alsoOther: hasNotes };
    }
    if (hasNotes && book.notes.toLowerCase().includes(ql)) {
      return { text: book.notes, kind: 'Notes', alsoOther: hasReview };
    }
  }
  if (hasReview) return { text: book.review, kind: 'Review', alsoOther: hasNotes };
  return { text: book.notes, kind: 'Notes', alsoOther: false };
}

export default function Notes() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.getBooks({ has_writing: 1, sort: 'updated', limit: 200 })
      .then(d => { if (!cancelled) setBooks(d.books || []); })
      .catch(() => { if (!cancelled) setError('Failed to load notes.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Filter against either field's prose. Case-insensitive substring —
  // good enough for personal-prose-search; phrase / fuzzy / regex are
  // overkill and would clutter the input. Tabs and other whitespace
  // are preserved in the stored text but flattened by stripMarkdown
  // at render time; we still match the raw text since the user
  // typically searches for a word that lives intact across whitespace.
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return books;
    const ql = q.toLowerCase();
    return books.filter(b =>
      (b.notes  && b.notes.toLowerCase().includes(ql)) ||
      (b.review && b.review.toLowerCase().includes(ql))
    );
  }, [books, query]);

  const activeQuery = query.trim();

  return (
    <div className="max-w-5xl">
      <h1 className="font-slab text-3xl text-parchment mb-1">Notes</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Reviews and notes you've written, most recent first.
      </p>

      {!loading && !error && books.length > 0 && (
        <div className="relative mb-3">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search within your notes…"
            aria-label="Search notes"
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
      )}

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <p role="alert" className="text-sm text-warn">{error}</p>
      ) : books.length === 0 ? (
        <p className="text-neutral-600">No notes or reviews written yet.</p>
      ) : (
        <>
          <p className="text-xs text-neutral-600 mb-3">
            {activeQuery
              ? <>{plural(filtered.length, 'book')} match <span className="text-neutral-500">"{activeQuery}"</span></>
              : <>{plural(books.length, 'book')} with writing</>}
          </p>
          {filtered.length === 0 ? (
            <p className="text-neutral-600 py-8">No matches.</p>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {filtered.map(book => {
                const primary = selectPrimary(book, activeQuery);
                const snip = snippet(primary.text, activeQuery);
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
                            {primary.kind}
                          </span>
                          {primary.alsoOther && (
                            <span className="text-[10px] text-neutral-700 flex-shrink-0">
                              + {primary.kind === 'Review' ? 'notes' : 'review'}
                            </span>
                          )}
                        </div>
                        {authorByline && (
                          <p className="text-xs text-neutral-500 mb-1.5 truncate">{authorByline}</p>
                        )}
                        <p className="text-sm text-neutral-400 line-clamp-2 whitespace-pre-line">
                          {highlight(snip.text, snip.matchStart, snip.matchLen)}
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
          )}
        </>
      )}
    </div>
  );
}
