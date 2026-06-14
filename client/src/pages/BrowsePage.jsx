import { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { plural, FORMAT_LABEL } from '../utils.js';
import BookCard from '../components/BookCard.jsx';
import CoverSizeSlider from '../components/CoverSizeSlider.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { GridSkeleton } from '../components/Skeleton.jsx';
import { useCoverSize } from '../hooks/useCoverSize.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { usePaginatedFetch } from '../hooks/usePaginatedFetch.js';

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

// Empty-state copy keyed on the browse field. The page's filter is the
// URL, not interactive, so the message is fixed once the route is set —
// we just say what isn't matched. fiction and format branch on the raw
// `decoded` URL value so the unset-status link from Stats's donut chart
// (and any direct-typed unset URL) gets specific phrasing instead of a
// generic fallback.
function emptyMessageFor(field, decoded, heading) {
  switch (field) {
    case 'author':            return `No books by ${heading}.`;
    case 'translator':        return `No books translated by ${heading}.`;
    case 'narrator':          return `No books narrated by ${heading}.`;
    case 'publisher':         return `No books from ${heading}.`;
    case 'series':            return `No books in the ${heading} series.`;
    case 'tag':               return `No books tagged ${heading}.`;
    case 'language':          return `No books in ${heading}.`;
    case 'original_language': return `No books originally in ${heading}.`;
    case 'rating':            return `No books rated ${heading}.`;
    case 'year_finished':     return `No books finished in ${heading}.`;
    case 'year_acquired':     return `No books acquired in ${heading}.`;
    case 'author_gender':     return `No books by ${heading} authors.`;
    case 'fiction':
      if (decoded === 'fiction')    return 'No fiction in your library.';
      if (decoded === 'nonfiction') return 'No non-fiction in your library.';
      if (decoded === 'unset')      return 'No books with unset fiction status.';
      return 'No books match this browse.';
    case 'format':
      if (decoded === 'physical')   return 'No physical books in your library.';
      if (decoded === 'ebook')      return 'No ebooks in your library.';
      if (decoded === 'audiobook')  return 'No audiobooks in your library.';
      if (decoded === 'unset')      return 'No books with unset format.';
      return 'No books match this browse.';
    default:                  return 'No books found.';
  }
}

const PAGE_SIZE = 48;

// Fields where "Show unowned" makes sense as a per-page toggle: series,
// publisher, and tag are collection-scoping slices where the dominant
// question is "what do I own under this slice". Other fields (author,
// year_finished, rating, etc.) either have their own canonical surface
// or are about reading/quality rather than collection state.
const OWNED_TOGGLE_FIELDS = new Set(['series', 'tag', 'publisher']);

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

  // Cohort fetch — independent of the paginated visible-books fetch so
  // BookDetail's prev/next can walk past the first PAGE_SIZE books in
  // this browse view. Server caps at 200; oversize views truncate there.
  const [cohort, setCohort] = useState([]);
  // Owned/unowned toggle for collection-scoping slices. Default off so the
  // page reads as "what I own under this slice"; resets per-target so a
  // stuck toggle doesn't carry between browse views.
  const usesOwnedToggle = OWNED_TOGGLE_FIELDS.has(field);
  // Toggle preference is session-wide via localStorage so browsing through
  // several series with unowned visible doesn't require re-clicking on each.
  // Shared key with Author page so the intent carries across surfaces.
  const [showUnowned, setShowUnowned] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('spine-show-unowned') === 'true',
  );
  // Series-only love toggle. The SeriesIndex page also exposes a heart
  // column, but the natural place to love a series is on its browse
  // view (where you're actually looking at the books). Fetched once
  // when field === 'series' from the loved-series endpoint and checked
  // for membership; null while loading so the button stays neutral.
  const [seriesLoved, setSeriesLoved] = useState(null);
  const [seriesLoveBusy, setSeriesLoveBusy] = useState(false);
  const [seriesLoveError, setSeriesLoveError] = useState(null);
  // Hoisted ahead of the seriesLoved useEffect below so it can list
  // refreshTick in its deps; the other consumers of refreshTick (the
  // main books fetch + the cohort fetch) sit further down and would
  // otherwise have prompted leaving the declaration in the lower
  // hook cluster, but that lower position would have hit the TDZ
  // when the seriesLoved effect tried to subscribe.
  const refreshTick = useRefreshTick();
  useEffect(() => {
    if (field !== 'series') { setSeriesLoved(null); return; }
    let stale = false;
    api.getSeries({ loved: 1 })
      .then(rows => { if (!stale) setSeriesLoved(Array.isArray(rows) && rows.some(r => r.name === decoded)); })
      .catch(() => { /* silent — button defaults to unhearted, click will retry via PATCH */ });
    return () => { stale = true; };
  }, [field, decoded, refreshTick]);
  async function toggleSeriesLoved() {
    if (seriesLoveBusy) return;
    setSeriesLoveBusy(true);
    setSeriesLoveError(null);
    const prev = !!seriesLoved;
    const next = !prev;
    setSeriesLoved(next);
    try {
      await api.patchSeriesLoved(decoded, next);
    } catch {
      setSeriesLoved(prev);
      setSeriesLoveError('Failed to update loved.');
    } finally {
      setSeriesLoveBusy(false);
    }
  }
  useEffect(() => {
    localStorage.setItem('spine-show-unowned', showUnowned ? 'true' : 'false');
  }, [showUnowned]);
  const ownedTab = (usesOwnedToggle && !showUnowned) ? 'owned' : undefined;
  const { size: coverSize, setSize: setCoverSize, cols: gridCols, compact, gridStyle, gridClassName, MIN: coverMin, MAX: coverMax } = useCoverSize();

  // Paginated visible-books fetch. key includes the owned-toggle so
  // flipping it is treated as a real navigation (skeleton flash) the
  // same way as field/value changes. unowned_total comes back only on
  // the first page when counts=owned is passed; the hook's meta merges
  // across pages within the same key so subsequent loadMore calls don't
  // wipe it.
  const {
    items: books, setItems: setBooks,
    total, meta,
    loading, loadingMore, loadingAll,
    hasMore, loadedCount,
    error: fetchError,
    setError: setFetchError,
    actionError,
    loadMore, loadAll,
  } = usePaginatedFetch(
    (offset, limit) => api.getBooks({
      field, value: decoded, tab: ownedTab, sort: browseSort(field),
      limit, offset,
      counts: offset === 0 && usesOwnedToggle ? 'owned' : undefined,
    }).then(r => ({
      items: r.books,
      total: r.total,
      // Only include unowned_total on the first page (when we passed
      // counts=owned). meta merges within the same key, so this value
      // survives loadMore / loadAll until the next key change.
      ...(r.unowned_total !== undefined ? { unowned_total: r.unowned_total } : {}),
    })),
    [field, decoded, ownedTab, usesOwnedToggle],
    {
      key: `${field}|${decoded}|${ownedTab ?? ''}`,
      pageSize: PAGE_SIZE,
    },
  );
  // No unowned_total when usesOwnedToggle is false (we don't pass
  // counts=owned for non-toggle browses); the original setUnownedCount(0)
  // branch survives here as a default.
  const unownedCount = usesOwnedToggle ? (meta.unowned_total ?? 0) : 0;

  // Parallel cohort fetch — see [cohort] declaration above for rationale.
  useEffect(() => {
    setCohort([]);
    let cancelled = false;
    api.getBooks({
      field, value: decoded, tab: ownedTab, sort: browseSort(field), limit: 200,
    })
      .then(({ books: b }) => {
        if (cancelled) return;
        setCohort(b.map(x => ({ id: x.id, title: x.title })));
      })
      .catch(() => { /* fall back to the visible-books shape in linkState */ });
    return () => { cancelled = true; };
  }, [field, decoded, ownedTab, refreshTick]);

  const label = FIELD_LABEL[field] ?? field;

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
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{heading}</h1>
            {field === 'series' && (() => {
              // null = still loading the membership check; render an
              // outline that doesn't claim a state.
              const isLoved = !!seriesLoved;
              const ttl = seriesLoved == null ? 'Loved (loading…)' : isLoved ? 'Remove from loved' : 'Mark as loved';
              return (
                <button
                  type="button"
                  onClick={toggleSeriesLoved}
                  disabled={seriesLoveBusy || seriesLoved == null}
                  title={ttl}
                  aria-label={`${ttl}: ${heading}`}
                  aria-pressed={isLoved}
                  className={`transition-colors disabled:opacity-60 ${isLoved ? 'text-red-400 hover:text-red-300' : 'text-neutral-700 hover:text-neutral-400'}`}
                >
                  <span className="text-2xl leading-none">{isLoved ? '♥' : '♡'}</span>
                </button>
              );
            })()}
          </div>
          {!loading && <p className="text-sm text-neutral-500 mt-1">{plural(total, 'book')}</p>}
          {seriesLoveError && <p role="alert" className="text-xs text-warn mt-1">{seriesLoveError}</p>}
        </div>
        {!loading && books.length > 0 && (
          <CoverSizeSlider size={coverSize} onChange={setCoverSize} min={coverMin} max={coverMax} />
        )}
      </div>

      {!loading && usesOwnedToggle && unownedCount > 0 && (
        <div className="mb-4 flex items-center gap-4 flex-wrap">
          <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500 cursor-pointer hover:text-neutral-300 transition-colors">
            <input
              type="checkbox"
              checked={showUnowned}
              onChange={(e) => setShowUnowned(e.target.checked)}
              className="accent-oak"
            />
            <span>Include unowned ({unownedCount})</span>
          </label>
        </div>
      )}

      {/* First-load failure (no books yet) replaces the view with an
          error message; a refresh-tick failure on an already-loaded
          page surfaces as a dismissible banner above the existing
          books. The books-fetch effect's same-target branch already
          skips setBooks([]), so books survive a failed refetch — the
          render just has to acknowledge them. */}
      {books.length > 0 && (
        <ErrorBanner
          message={fetchError ? 'Failed to refresh. Showing the last loaded results.' : null}
          onDismiss={() => setFetchError(null)}
          className="mb-4"
        />
      )}

      {loading ? (
        <GridSkeleton
          count={15}
          compact={compact}
          gridStyle={gridStyle}
          gridClassName={gridClassName}
        />
      ) : books.length === 0 && fetchError ? (
        <div className="text-center py-32">
          <p className="text-neutral-600">Failed to load books. Please try again.</p>
        </div>
      ) : books.length === 0 ? (
        <div className="text-center py-32">
          {ownedTab && unownedCount > 0 ? (
            <>
              {/* Owned-only default surfaced an empty slice (e.g. a series
                  you don't yet own anything from). Acknowledge the unowned
                  books and offer one click to reveal them, so the page
                  doesn't read as a dead end. */}
              <p className="text-neutral-600">
                No owned books — {unownedCount} unowned.
              </p>
              <button
                type="button"
                onClick={() => setShowUnowned(true)}
                className="mt-3 text-sm text-oak hover:text-leather transition-colors"
              >
                Show unowned →
              </button>
            </>
          ) : (
            <p className="text-neutral-600">{emptyMessageFor(field, decoded, heading)}</p>
          )}
        </div>
      ) : (() => {
        // Mid-pagination, hide trailing partial-row books; reveal on next load.
        // Guard: keep at least one full row so a small load doesn't render empty.
        const trim = hasMore && gridCols > 0 && books.length > gridCols ? books.length % gridCols : 0;
        const visible = trim > 0 ? books.slice(0, -trim) : books;
        // Prefer the separate cohort fetch (up to the 200 server cap) so
        // prev/next walks past the first PAGE_SIZE books in this browse
        // view. Falls back to the visible-loaded set if the cohort fetch
        // hasn't landed yet.
        const linkStateWithCohort = {
          ...fromState,
          cohort: cohort.length > 0 ? cohort : books.map(b => ({ id: b.id, title: b.title })),
        };
        return (
          <div className={gridClassName} style={gridStyle}>
            {visible.map(book => <BookCard key={book.id} book={book} compact={compact} linkState={linkStateWithCohort} />)}
          </div>
        );
      })()}
      {hasMore && (
        <div className="mt-10 flex flex-col items-center gap-2">
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore || loadingAll}
              className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-60 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
            >
              {loadingMore ? 'Loading…' : `Load more · ${total - loadedCount} remaining`}
            </button>
            <button
              type="button"
              onClick={loadAll}
              disabled={loadingMore || loadingAll}
              className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-60 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
            >
              {loadingAll ? `Loading all · ${loadedCount}/${total}` : 'Load all'}
            </button>
          </div>
          {actionError && <p role="alert" className="text-xs text-warn">Failed to load more books.</p>}
        </div>
      )}
    </div>
  );
}

