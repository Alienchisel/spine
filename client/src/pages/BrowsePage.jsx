import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { plural } from '../utils.js';
import BookCard from '../components/BookCard.jsx';
import CoverSizeSlider from '../components/CoverSizeSlider.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { useCoverSize } from '../hooks/useCoverSize.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';

const FIELD_LABEL = {
  author: 'Author', translator: 'Translator', publisher: 'Publisher',
  series: 'Series', tag: 'Tag', fiction: '', format: '', language: 'Language',
  original_language: 'Original language',
  narrator: 'Narrator', rating: 'Rating', year_finished: 'Finished', year_acquired: 'Acquired',
  author_gender: 'Author gender',
};

const AUTHOR_GENDER_LABEL = {
  male: 'Male', female: 'Female', other: 'Other', unassigned: 'Unassigned',
};

const FORMAT_LABEL = { physical: 'Physical', ebook: 'Digital', audiobook: 'Audiobook' };

function starsLabel(r) {
  const full = Math.floor(r);
  const half = r % 1 !== 0;
  return '★'.repeat(full) + (half ? '½' : '');
}

function browseSort(field) {
  if (field === 'series')       return 'series_order';
  if (field === 'year_finished') return 'finished';
  if (field === 'year_acquired') return 'acquired';
  return 'title';
}

const PAGE_SIZE = 48;

export default function BrowsePage() {
  const { field, value } = useParams();
  const decoded = decodeURIComponent(value);
  const { state, pathname } = useLocation();
  const backLabel = state?.from ? `← ${state.from}` : '← Library';
  const backPath  = state?.fromPath ?? '/';
  // Human-readable name for the current browse view. The raw URL value
  // for fiction/format/rating fields is "0" / "1" / "physical" — fine
  // for the URL, useless to display. Year fields stay as the bare year:
  // the eyebrow above (Acquired / Finished) provides the disambiguation
  // on this page, so prefixing the heading would duplicate the eyebrow.
  const heading = field === 'fiction'
    ? (decoded === 'fiction' ? 'Fiction' : decoded === 'nonfiction' ? 'Non-fiction' : 'Fiction / NF unset')
    : field === 'format'        ? (FORMAT_LABEL[decoded] ?? decoded)
    : field === 'rating'        ? starsLabel(parseFloat(decoded))
    : field === 'author_gender' ? (AUTHOR_GENDER_LABEL[decoded] ?? decoded)
    : decoded;
  // Back-link label carried to BookDetail. Same as the heading except
  // year fields fold the eyebrow into the label so "← 2026" isn't
  // ambiguous between acquired-by-year and finished-by-year browse
  // paths — once off this page, the eyebrow context is gone.
  const fromLabel = field === 'year_acquired' ? `Acquired ${decoded}`
                  : field === 'year_finished' ? `Finished ${decoded}`
                  : heading;
  const fromState = useMemo(
    () => ({ from: fromLabel, fromPath: pathname }),
    [fromLabel, pathname],
  );

  const [books,       setBooks]       = useState([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll,  setLoadingAll]  = useState(false);
  // Initial load failure: replaces the empty-state with an error message.
  const [fetchError,  setFetchError]  = useState(false);
  // Pagination failure: leaves loaded books visible, shows near Load more.
  const [actionError, setActionError] = useState(null);
  const loadedRef = useRef(0);
  const guard     = useStaleGuard();
  // Synchronous mirror of the loadingMore/loadingAll *pair*. State setters
  // don't commit until next render — so two same-tick clicks (or Load
  // more + Load all together) all pass the `loadingMore || loadingAll`
  // check, fire duplicate getBooks at the same offset, and double-bump
  // loadedRef.current. Mirrors Library.pagingRef.
  const pagingRef = useRef(false);
  const { size: coverSize, setSize: setCoverSize, cols: gridCols, compact, gridStyle, gridClassName, MIN: coverMin, MAX: coverMax } = useCoverSize();
  const refreshTick = useRefreshTick();
  // Snapshot of the browse target so we can distinguish navigation
  // (different field/value → wipe to loading) from refresh-tick
  // refetch (same target → keep books visible so scroll position
  // survives the alt-tab roundtrip). Same shape as the Library /
  // Diary / ShelfView fixes.
  const lastTargetRef = useRef('');

  useEffect(() => {
    // Capture this navigation's generation. If the user navigates to a
    // different field/value before the fetch resolves, a later useEffect
    // run will bump the guard's epoch and these guards will short-circuit
    // the stale response so it can't overwrite the new browse target.
    const epoch = guard.next();
    const target = `${field}|${decoded}`;
    const isSameTarget = target === lastTargetRef.current;
    lastTargetRef.current = target;
    setFetchError(false);
    if (!isSameTarget) {
      setLoading(true);
      setBooks([]);
    }
    // Reset pagination flags + action banner: a refresh-tick / nav between
    // browse targets that fires while loadMore/loadAll is in flight would
    // otherwise strand the flags at true (their finally clauses are gated
    // on epoch match) and leave the previous failure banner sitting above
    // the new browse view.
    setLoadingMore(false);
    setLoadingAll(false);
    setActionError(null);
    loadedRef.current = 0;
    api.getBooks({ field, value: decoded, sort: browseSort(field), limit: PAGE_SIZE, offset: 0 })
      .then(({ books: b, total: t }) => {
        if (!guard.isFresh(epoch)) return;
        setBooks(b);
        setTotal(t);
        loadedRef.current = b.length;
      })
      .catch(() => { if (guard.isFresh(epoch)) setFetchError(true); })
      .finally(() => { if (guard.isFresh(epoch)) setLoading(false); });
  }, [field, decoded, refreshTick]);

  function handleLoadMore() {
    if (pagingRef.current || loadingMore || loadingAll) return;
    const epoch = guard.current();
    pagingRef.current = true;
    setLoadingMore(true);
    setActionError(null);
    api.getBooks({ field, value: decoded, sort: browseSort(field), limit: PAGE_SIZE, offset: loadedRef.current })
      .then(({ books: b, total: t }) => {
        if (!guard.isFresh(epoch)) return;
        setBooks(prev => [...prev, ...b]);
        setTotal(t);
        loadedRef.current += b.length;
      })
      .catch(() => {
        if (guard.isFresh(epoch)) setActionError('Failed to load more books.');
      })
      .finally(() => {
        // Clear unconditionally — a nav between browse targets bumps gen
        // and resets loadingMore via setState; a stranded ref would
        // block all future paging on the new view.
        pagingRef.current = false;
        if (guard.isFresh(epoch)) setLoadingMore(false);
      });
  }

  async function handleLoadAll() {
    if (pagingRef.current || loadingMore || loadingAll) return;
    const epoch = guard.current();
    pagingRef.current = true;
    setLoadingAll(true);
    setActionError(null);
    try {
      let serverTotal = total;
      while (guard.isFresh(epoch) && loadedRef.current < serverTotal) {
        const { books: b, total: t } = await api.getBooks({ field, value: decoded, sort: browseSort(field), limit: PAGE_SIZE, offset: loadedRef.current });
        if (!guard.isFresh(epoch)) break;
        setBooks(prev => [...prev, ...b]);
        setTotal(t);
        loadedRef.current += b.length;
        serverTotal = t;
        if (b.length === 0) break;
      }
    } catch {
      if (guard.isFresh(epoch)) setActionError('Failed to load more books.');
    } finally {
      pagingRef.current = false;
      if (guard.isFresh(epoch)) setLoadingAll(false);
    }
  }

  const label = FIELD_LABEL[field] ?? field;

  const hasMore = loadedRef.current < total;

  return (
    <div>
      {/* state.origin carries the deeper-back chain forward: when this page
          was reached from a BookDetail that itself came from /?tab=all,
          state.origin holds the original Library tab context. Passing
          it through here lets BookDetail's back-link restore that tab
          instead of falling back to the Reading default. */}
      <Link to={backPath} state={state?.origin ?? undefined} className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        {backLabel}
      </Link>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          {label && <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">{label}</p>}
          <h1 className="text-2xl font-bold text-white">{heading}</h1>
          {!loading && <p className="text-sm text-neutral-500 mt-1">{plural(total, 'book')}</p>}
        </div>
        {!loading && books.length > 0 && (
          <CoverSizeSlider size={coverSize} onChange={setCoverSize} min={coverMin} max={coverMax} />
        )}
      </div>

      {/* First-load failure (no books yet) replaces the view with an
          error message; a refresh-tick failure on an already-loaded
          page surfaces as a dismissible banner above the existing
          books. The books-fetch effect's same-target branch already
          skips setBooks([]), so books survive a failed refetch — the
          render just has to acknowledge them. */}
      {books.length > 0 && (
        <ErrorBanner
          message={fetchError ? 'Failed to refresh. Showing the last loaded results.' : null}
          onDismiss={() => setFetchError(false)}
          className="mb-4"
        />
      )}

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : books.length === 0 && fetchError ? (
        <div className="text-center py-32">
          <p className="text-neutral-600">Failed to load books. Please try again.</p>
        </div>
      ) : books.length === 0 ? (
        <div className="text-neutral-600 text-sm">No books found.</div>
      ) : (() => {
        // Mid-pagination, hide trailing partial-row books; reveal on next load.
        // Guard: keep at least one full row so a small load doesn't render empty.
        const trim = hasMore && gridCols > 0 && books.length > gridCols ? books.length % gridCols : 0;
        const visible = trim > 0 ? books.slice(0, -trim) : books;
        return (
          <div className={gridClassName} style={gridStyle}>
            {visible.map(book => <BookCard key={book.id} book={book} compact={compact} linkState={fromState} />)}
          </div>
        );
      })()}
      {hasMore && (
        <div className="mt-10 flex flex-col items-center gap-2">
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore || loadingAll}
              className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
            >
              {loadingMore ? 'Loading…' : `Load more · ${total - loadedRef.current} remaining`}
            </button>
            <button
              type="button"
              onClick={handleLoadAll}
              disabled={loadingMore || loadingAll}
              className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
            >
              {loadingAll ? `Loading all · ${loadedRef.current}/${total}` : 'Load all'}
            </button>
          </div>
          {actionError && <p role="alert" className="text-xs text-warn">{actionError}</p>}
        </div>
      )}
    </div>
  );
}

