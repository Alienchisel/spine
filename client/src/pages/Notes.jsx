import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { initialsFor, plural, pluralWord } from '../utils.js';
import { useFreshFetch } from '../hooks/useFreshFetch.js';
import { NotesSkeleton } from '../components/Skeleton.jsx';

// Surfaces the reflective layer — user-authored prose (review + notes)
// across the library — as a first-class destination, instead of leaving
// it buried per-book on BookDetail's right rail.
//
// v3 adds tag filtering on top of v2's client-side text search. Clicking
// a tag pill on any row toggles it in the active filter; active filters
// AND-combine with each other and with the search query. Tags are the
// "browse by topic" axis that makes Notes distinct from BookDetail — if
// the catalogue answers "what books do I own about Philosophy?", Notes
// answers "what have I written about Philosophy?".

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
  // SQLite datetime strings come as 'YYYY-MM-DD HH:MM:SS' (space separator).
  // `new Date(str)` of that form works in V8 / Firefox but isn't
  // ECMAScript-conformant — Safari historically rejected it. Swap in 'T' so
  // the parse is ISO-conformant in every engine.
  const d = new Date(String(iso).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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

// Pick which field's text to preview. Priority:
//   1. Query: if active, prefer whichever field contains the match so
//      the snippet shows the matched passage.
//   2. Kind filter: on the Notes tab show notes even when the book has
//      a review; on the Reviews tab show review.
//   3. Default: review wins (more formal, longer-lived).
function selectPrimary(book, q, kindFilter) {
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
  if (kindFilter === 'notes' && hasNotes) {
    return { text: book.notes, kind: 'Notes', alsoOther: hasReview };
  }
  if (kindFilter === 'reviews' && hasReview) {
    return { text: book.review, kind: 'Review', alsoOther: hasNotes };
  }
  if (hasReview) return { text: book.review, kind: 'Review', alsoOther: hasNotes };
  return { text: book.notes, kind: 'Notes', alsoOther: false };
}

// Kind filter tabs — All shows everything with writing, Reviews narrows
// to books with a non-empty review, Notes narrows to books with a non-
// empty note. Reviews and Notes overlap (a book with both appears in
// both) — by design, "filter to anything that has X" reads more
// naturally than "filter to only-X."
const KIND_TABS = [
  { key: 'all',     label: 'All',     noun: 'book' },
  { key: 'reviews', label: 'Reviews', noun: 'review' },
  { key: 'notes',   label: 'Notes',   noun: 'note' },
];
const KIND_KEYS = new Set(KIND_TABS.map(t => t.key));

// Row-level tag pill — visible as a button so the user can click any
// tag on any row to add it to the active filter. The pill style mirrors
// BookDetail's real-tag pills (bg-neutral-800 / text-neutral-400 /
// rounded-full) but sized a notch smaller to fit the dense row layout.
// Lives OUTSIDE the row's <Link> so the click doesn't bubble into a
// navigation — nested interactive elements would also be an a11y bug.
function TagPill({ name, active, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(name)}
      aria-pressed={active}
      className={`text-[11px] px-2 py-0.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 ${
        active
          ? 'bg-oak/30 text-parchment'
          : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
      }`}
    >
      {name}
    </button>
  );
}

const ROW_TAG_LIMIT = 4;

export default function Notes() {
  // Alt-tab refetch — mirrors every other list-style page (Library,
  // Diary, Loved, …). Without this, edits made elsewhere (a review
  // tweaked on BookDetail, a tag toggled in BookForm) don't show in
  // Notes until full page reload.
  const { data: books, loading, error } = useFreshFetch(
    () => api.getBooks({ has_writing: 1, sort: 'updated', limit: 200 }).then(d => d.books || []),
    [],
    { initialData: [] },
  );
  // Filter state lives on the URL so a navigate-to-BookDetail-then-back
  // restores the user's exact filter selection (the alt-tab path is
  // already covered by useRefreshTick). Same shape as Library and
  // Diary — `?q=…&tags=a,b,c&kind=reviews`.
  const [params, setParams] = useSearchParams();
  const query      = params.get('q') ?? '';
  const kindFilter = KIND_KEYS.has(params.get('kind')) ? params.get('kind') : 'all';
  const activeTags = useMemo(() => {
    const raw = params.get('tags') ?? '';
    return new Set(raw ? raw.split(',').filter(Boolean) : []);
  }, [params]);
  const setQuery = useCallback((q) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (q) next.set('q', q); else next.delete('q');
      return next;
    }, { replace: true });
  }, [setParams]);
  const searchRef = useRef(null);

  // Toggle a tag in the active-filter set. Empty → adds; present →
  // removes. Round-trips through the URL so back/forward navigation
  // restores the user's exact selection.
  const toggleTag = useCallback((name) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      const current = new Set((next.get('tags') ?? '').split(',').filter(Boolean));
      if (current.has(name)) current.delete(name); else current.add(name);
      if (current.size > 0) next.set('tags', [...current].join(',')); else next.delete('tags');
      return next;
    }, { replace: true });
  }, [setParams]);
  const setKindFilter = useCallback((kind) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (kind && kind !== 'all') next.set('kind', kind); else next.delete('kind');
      return next;
    }, { replace: true });
  }, [setParams]);

  // Combined filter: text match (notes OR review) AND tag intersection
  // (every active tag must be present on the book's real-tag list).
  // Virtual tags (Antique/Vintage/Long/Tome) are excluded from the
  // filterable set — they're derived properties, not user-curated
  // topics, and would muddy the "browse by topic" intent.
  // Pre-narrow by kind so the per-tab cohort count is cheap to read off
  // the result of `kindCohort.filter(...)` downstream. The kind filter
  // is orthogonal to query + tags (AND-combined): a Reviews-tab search
  // is "within reviews."
  const kindCohort = useMemo(() => {
    if (kindFilter === 'reviews') return books.filter(b => b.review && b.review.trim());
    if (kindFilter === 'notes')   return books.filter(b => b.notes  && b.notes.trim());
    return books;
  }, [books, kindFilter]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const ql = q.toLowerCase();
    const tagsToMatch = activeTags;
    return kindCohort.filter(b => {
      if (q) {
        const hit = (b.notes  && b.notes.toLowerCase().includes(ql))
                 || (b.review && b.review.toLowerCase().includes(ql));
        if (!hit) return false;
      }
      if (tagsToMatch.size > 0) {
        const bookTags = new Set((b.tags || []).filter(t => !t.virtual).map(t => t.name));
        for (const name of tagsToMatch) if (!bookTags.has(name)) return false;
      }
      return true;
    });
  }, [kindCohort, query, activeTags]);

  const activeQuery = query.trim();
  const anyFilter = activeQuery !== '' || activeTags.size > 0;
  const kindNoun = KIND_TABS.find(t => t.key === kindFilter).noun;

  // Cohort threading — BookDetail's prev/next walks the filtered Notes
  // view (same shape as Library / ListDetail / Loved). Without this, a
  // user clicking into a note's book lands at BookDetail and prev/next
  // falls back to series siblings only, losing the Notes browse flow.
  const linkState = useMemo(() => ({
    from: 'Notes',
    fromPath: '/notes',
    cohort: filtered.map(b => ({ id: b.id, title: b.title })),
  }), [filtered]);

  return (
    <div className="max-w-5xl">
      <h1 className="font-slab text-3xl text-parchment mb-1">Notes</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Reviews and notes you've written, most recent first.
      </p>

      {!loading && !error && books.length > 0 && (
        <>
          {/* Kind tabs — All / Reviews / Notes. Lightweight segmented
              row above the search input so the cohort is the first
              choice the user makes on the page. */}
          <div role="tablist" aria-label="Filter by kind" className="mb-3 flex items-center gap-1 text-xs">
            {KIND_TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={kindFilter === key}
                onClick={() => setKindFilter(key)}
                className={`px-2.5 py-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 ${
                  kindFilter === key
                    ? 'bg-neutral-800 text-parchment'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
        </>
      )}

      {/* Active filter chip row — shown only when at least one tag is
          selected. Each chip removes its tag on click; "Clear" wipes
          the whole filter. Search-query removal is on the search input
          itself (native ✕). */}
      {activeTags.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {[...activeTags].map(name => (
            <button
              key={name}
              type="button"
              onClick={() => toggleTag(name)}
              aria-label={`Remove filter ${name}`}
              className="text-xs bg-oak/30 text-parchment rounded-full pl-3 pr-1.5 py-1 flex items-center gap-1.5 hover:bg-oak/40 transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40"
            >
              <span>{name}</span>
              <span aria-hidden="true" className="text-parchment/60 leading-none text-sm">×</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setParams(prev => {
              const next = new URLSearchParams(prev);
              next.delete('tags');
              return next;
            }, { replace: true })}
            className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors ml-1 focus:outline-none focus-visible:text-neutral-300 focus-visible:underline underline-offset-2"
          >
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <NotesSkeleton />
      ) : error ? (
        <p role="alert" className="text-sm text-warn">Failed to load notes.</p>
      ) : books.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-neutral-600 mb-3">No notes or reviews written yet.</p>
          <p className="text-sm text-neutral-600">
            Open any book and use its detail page to write a <Link to="/" className="text-leather hover:text-parchment transition-colors underline-offset-2 hover:underline">note or review</Link>.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-neutral-600 mb-3">
            {anyFilter
              ? <>{filtered.length} of {kindCohort.length} {pluralWord(kindCohort.length, kindNoun)}</>
              : kindFilter === 'all'
                ? <>{plural(kindCohort.length, kindNoun)} with writing</>
                : <>{plural(kindCohort.length, kindNoun)}</>}
          </p>
          {filtered.length === 0 ? (
            <p className="text-neutral-600 py-8">No matches for the current filters.</p>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {filtered.map(book => {
                const primary = selectPrimary(book, activeQuery, kindFilter);
                const snip = snippet(primary.text, activeQuery);
                const authorByline = (book.authors || []).map(a => a.name).join(', ');
                const realTags = (book.tags || []).filter(t => !t.virtual);
                const visibleTags = realTags.slice(0, ROW_TAG_LIMIT);
                const overflowCount = realTags.length - visibleTags.length;
                return (
                  <li key={book.id} className="py-4">
                    <Link
                      to={`/books/${book.id}`}
                      state={linkState}
                      className="flex gap-4 group focus:outline-none focus-visible:bg-neutral-900/40 -mx-2 px-2 rounded transition-colors"
                    >
                      {/* Thumbnail — small, just enough to anchor the row
                          to a book. Falls back to initials if no cover. */}
                      <div className="flex-shrink-0 w-12 h-16 rounded-sm bg-neutral-800 overflow-hidden">
                        {book.cover_path ? (
                          <img src={book.cover_path} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
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

                    {/* Tag pills sit OUTSIDE the row's Link so clicking
                        a tag toggles it in the filter rather than
                        navigating into the book. Indented to align with
                        the main content column above (w-12 cover + gap-4
                        ≈ 4rem). */}
                    {visibleTags.length > 0 && (
                      <div className="ml-16 mt-1.5 flex flex-wrap gap-1.5">
                        {visibleTags.map(t => (
                          <TagPill
                            key={t.id ?? t.name}
                            name={t.name}
                            active={activeTags.has(t.name)}
                            onToggle={toggleTag}
                          />
                        ))}
                        {overflowCount > 0 && (
                          <span className="text-[11px] text-neutral-700 leading-none self-center">
                            +{overflowCount}
                          </span>
                        )}
                      </div>
                    )}
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
