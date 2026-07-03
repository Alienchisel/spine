import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link, useLocation, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { plural, FORMAT_LABEL } from '../utils.js';
import BookCard from '../components/BookCard.jsx';
import CoverSizeSlider from '../components/CoverSizeSlider.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { GridSkeleton } from '../components/Skeleton.jsx';
import { useCoverSize } from '../hooks/useCoverSize.js';

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

// Fields that expose the per-page format chip row. Every general slice
// where a multi-format spread is plausible — series, tag, publisher,
// language, etc. The chip row is gated on the slice actually spanning
// >1 format (see availableFormats below), so single-format browses
// stay clean without per-field gating here. Excluded: narrator
// (audiobook-only by definition), format (filtering format on a
// format-pinned view is a no-op).
const FORMAT_CHIP_FIELDS = new Set([
  'series', 'tag', 'publisher',
  'language', 'original_language', 'translator',
  'year_finished', 'year_acquired',
  'rating', 'fiction', 'author_gender',
]);
const VALID_FORMATS = new Set(['physical', 'ebook', 'audiobook']);

export default function BrowsePage() {
  const { field, value } = useParams();
  const decoded = decodeURIComponent(value);
  const { state, pathname, search } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // Format chip lives in the URL so the back-link from BookDetail and
  // browser-history navigation restore the filtered view. Only honored
  // for fields in FORMAT_CHIP_FIELDS; other fields ignore stray ?format=.
  const usesFormatChip = FORMAT_CHIP_FIELDS.has(field);
  const rawFormat = searchParams.get('format');
  const format = usesFormatChip && VALID_FORMATS.has(rawFormat) ? rawFormat : null;
  function setFormat(next) {
    const sp = new URLSearchParams(searchParams);
    if (next == null) sp.delete('format');
    else              sp.set('format', next);
    setSearchParams(sp, { replace: true, state });
  }
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
  // Include `search` so the back-link from BookDetail restores any
  // active per-page filters (e.g. ?format=physical). Without it, a user
  // who drilled into a book from a filtered series view would land back
  // on the unfiltered series.
  const fromState = useMemo(
    () => ({ from: fromLabel, fromPath: pathname + search }),
    [fromLabel, pathname, search],
  );

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
  // seriesLoved membership check — a synthetic derived value from
  // the global loved-series query (['loved', 'series']), which is
  // already invalidated by the spine-event bridge on book mutations.
  const lovedSeriesQ = useQuery({
    queryKey: ['loved', 'series'],
    queryFn: () => api.getSeries({ loved: 1 }),
    placeholderData: (prev) => prev ?? [],
    enabled: field === 'series',
  });
  useEffect(() => {
    if (field !== 'series') { setSeriesLoved(null); return; }
    const rows = lovedSeriesQ.data;
    if (!Array.isArray(rows)) return;
    setSeriesLoved(rows.some(r => r.name === decoded));
  }, [field, decoded, lovedSeriesQ.data]);
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

  // Available-formats facet — drives the chip-row gating. Render the row
  // only when the cohort spans more than one format; if a series is
  // audiobook-only, the chip is just noise. Uses the unfiltered cohort
  // (no `formats` param) so picking a filter doesn't collapse the chip
  // row to a single pill.
  const availableFormatsQ = useQuery({
    queryKey: ['browse-facets', field, decoded],
    queryFn: () => api.getBookFacets({ field, value: decoded })
      .then(f => Array.isArray(f?.formats) ? f.formats : []),
    placeholderData: (prev) => prev ?? [],
    enabled: !!usesFormatChip,
  });
  const availableFormats = usesFormatChip ? (availableFormatsQ.data ?? []) : [];

  // Paginated visible-books fetch. key includes the owned-toggle so
  // flipping it is treated as a real navigation (skeleton flash) the
  // same way as field/value changes. unowned_total comes back only on
  // the first page when counts=owned is passed; the hook's meta merges
  // across pages within the same key so subsequent loadMore calls don't
  // wipe it.
  const booksQKey = ['browse', field, decoded, ownedTab ?? '', format ?? ''];
  const booksQ = useInfiniteQuery({
    queryKey: booksQKey,
    queryFn: ({ pageParam = 0 }) => api.getBooks({
      field, value: decoded, tab: ownedTab, sort: browseSort(field),
      formats: format ?? undefined,
      limit: PAGE_SIZE, offset: pageParam,
      counts: pageParam === 0 && usesOwnedToggle ? 'owned' : undefined,
    }).then(r => ({
      books: r.books, total: r.total, offset: pageParam,
      // unowned_total is only on the first-page response — carry it
      // forward on subsequent pages so the meta accessor below finds it.
      unowned_total: r.unowned_total,
    })),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.books.length;
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
  const books       = useMemo(() => booksQ.data?.pages.flatMap(p => p.books) ?? [], [booksQ.data]);
  const total       = booksQ.data?.pages.at(-1)?.total ?? 0;
  const loading     = booksQ.isPending;
  const loadingMore = booksQ.isFetchingNextPage;
  const hasMore     = !!booksQ.hasNextPage;
  const loadedCount = books.length;
  const fetchError  = booksQ.error;
  const setFetchError = () => { booksQ.refetch(); };
  const [actionError, setActionError] = useState(null);
  const [loadingAll,  setLoadingAll]  = useState(false);
  const loadMore = useCallback(async () => {
    if (booksQ.isFetchingNextPage) return;
    setActionError(null);
    try { await booksQ.fetchNextPage(); }
    catch (e) { setActionError(e); }
  }, [booksQ]);
  const loadAll = useCallback(async () => {
    if (loadingAll || booksQ.isFetchingNextPage) return;
    setLoadingAll(true); setActionError(null);
    try { while (booksQ.hasNextPage) await booksQ.fetchNextPage(); }
    catch (e) { setActionError(e); }
    finally { setLoadingAll(false); }
  }, [booksQ, loadingAll]);
  // unowned_total is captured on the first-page response and carried
  // forward through every subsequent page (see queryFn) so meta.pages[*]
  // all agree — read off page 0.
  const unownedCount = usesOwnedToggle ? (booksQ.data?.pages[0]?.unowned_total ?? 0) : 0;

  // Parallel cohort fetch — same key shape as the paginated books
  // above so a real navigation invalidates both in step.
  const cohortQ = useQuery({
    queryKey: ['browse-cohort', field, decoded, ownedTab ?? '', format ?? ''],
    queryFn: () => api.getBooks({
      field, value: decoded, tab: ownedTab, sort: browseSort(field), limit: 200,
      formats: format ?? undefined,
    }).then(({ books: b }) => b.map(x => ({ id: x.id, title: x.title }))),
    placeholderData: (prev) => prev ?? [],
  });
  const cohort = cohortQ.data ?? [];

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

      {usesFormatChip && availableFormats.length > 1 && (
        <div className="mb-4 flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setFormat(null)}
            aria-pressed={format == null}
            className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
              format == null
                ? 'bg-binding/50 text-parchment border-binding/70'
                : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
            }`}
          >
            All formats
          </button>
          {availableFormats.map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(format === f ? null : f)}
              aria-pressed={format === f}
              className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                format === f
                  ? 'bg-binding/50 text-parchment border-binding/70'
                  : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
              }`}
            >
              {FORMAT_LABEL[f] ?? f}
            </button>
          ))}
        </div>
      )}

      {/* The Include-unowned toggle persists across format-chip selections
          even when the current filter yields 0 unowned, so the user can
          always switch the toggle on/off without bouncing back to All
          formats first. Without that, picking a chip whose slice happens
          to be fully owned would hide the toggle entirely. */}
      {!loading && usesOwnedToggle && (unownedCount > 0 || (usesFormatChip && availableFormats.length > 1)) && (
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
          books. TanStack Query keeps the last loaded pages when a
          refetch fails, so books survive — the render just has to
          acknowledge them. */}
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

