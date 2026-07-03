import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';
import CoverSizeSlider from '../components/CoverSizeSlider.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { GridSkeleton } from '../components/Skeleton.jsx';
import PageHeading from '../components/PageHeading.jsx';
import { sectionEyebrow } from '../components/textStyles.js';
import { useCoverSize } from '../hooks/useCoverSize.js';
import { initialsFor, FORMAT_LABEL } from '../utils.js';

// /loved is the home of every loved entity in the library — books at
// the top (the historical Loved view), then authors, then series.
// Each section is independent: a flaky author fetch can't take down
// the books grid, and an empty section still renders its own
// "no loved X yet" hint instead of collapsing the page.
export default function Loved() {
  const queryClient = useQueryClient();
  // Three independent queries rather than one Promise.all so a flaky
  // section can't take down the others — each surface fails alone.
  // limit=200 on books is the /api/books cap. Without it, the server
  // default of 50 truncates the cohort that flows into BookDetail's
  // prev/next.
  //
  // staleTime: Infinity + no focus/mount/reconnect refetch is set
  // globally by queryClient.js — cache is invalidated instead by
  // (a) the spine:book-mutated / spine:book-deleted event bridge in
  // queryClient.js when a book is edited or deleted anywhere, and
  // (b) the optimistic setQueryData below when this page toggles a
  // book's loved status. Between mutations, tabbing away and back is
  // a no-op: cache is consulted, nothing refetches.
  // NOTE on placeholderData vs initialData: with staleTime: Infinity
  // (set globally in queryClient.js), initialData would seed the
  // cache as "fresh" and no fetch would ever fire. placeholderData
  // shows a value during the initial pending state but keeps
  // status='pending' so the queryFn does run. Passing (prev) => prev
  // also keeps the previous real data visible during any refetch
  // (invalidation from a mutation event) — the exact behaviour that
  // useFreshFetch's silent-refetch path provided.
  const booksQ = useQuery({
    queryKey: ['loved', 'books'],
    queryFn:  () => api.getBooks({ tab: 'loved', limit: 200 }).then(d => d.books),
    placeholderData: (prev) => prev ?? [],
  });
  const authorsQ = useQuery({
    queryKey: ['loved', 'authors'],
    queryFn:  () => api.getAuthors({ loved: 1 }).then(rows => Array.isArray(rows) ? rows : []),
    placeholderData: (prev) => prev ?? [],
  });
  const seriesQ = useQuery({
    queryKey: ['loved', 'series'],
    queryFn:  () => api.getSeries({ loved: 1 }).then(rows => Array.isArray(rows) ? rows : []),
    placeholderData: (prev) => prev ?? [],
  });
  const books   = booksQ.data   ?? [];
  const authors = authorsQ.data ?? [];
  const series  = seriesQ.data  ?? [];
  const loadingBooks   = booksQ.isPending;
  const loadingAuthors = authorsQ.isPending;
  const loadingSeries  = seriesQ.isPending;
  const bookError   = booksQ.error;
  const authorError = authorsQ.error;
  const seriesError = seriesQ.error;
  // ErrorBanner's dismiss is wired to refetch. In useQuery, error
  // state clears only on a successful refetch — no way to "just hide"
  // the error without retrying — so dismiss = retry is the honest
  // mapping. On retry failure the banner re-appears with the same
  // error.
  const dismissBookError = () => { booksQ.refetch(); };
  // Optimistic setter for handleBookUpdate below — mirrors what
  // useFreshFetch.setData did. setQueryData accepts a functional
  // updater directly. Guard the updater against an undefined cache —
  // TanStack Query's cache starts as undefined until the first fetch
  // lands, unlike useFreshFetch's useState(initialData).
  const setBooks = (updater) => {
    queryClient.setQueryData(
      ['loved', 'books'],
      (prev) => (typeof updater === 'function' ? updater(prev ?? []) : updater)
    );
  };
  const { size: coverSize, setSize: setCoverSize, compact, gridStyle, gridClassName, MIN: coverMin, MAX: coverMax } = useCoverSize();
  // Format chip — single-value local state, filters the Books section only.
  // Authors and Series sections are unaffected (an author / series isn't
  // bound to a single format). Reset is implicit on a page visit, not
  // localStorage-backed: a loved-format browse is exploratory, not a
  // standing preference.
  const [formatFilter, setFormatFilter] = useState(null);

  function handleBookUpdate(updated) {
    // Loved sorts by updated_at DESC (no UI selector). Splice the updated
    // book to the top so inline edits bump it right away, matching the
    // server's ordering on next mount.
    if (!updated.loved) {
      setBooks(bs => bs.filter(b => b.id !== updated.id));
    } else {
      setBooks(bs => [updated, ...bs.filter(b => b.id !== updated.id)]);
    }
  }

  const allEmpty = !loadingBooks && !loadingAuthors && !loadingSeries
    && books.length === 0 && authors.length === 0 && series.length === 0
    && !bookError && !authorError && !seriesError;

  return (
    <div>
      <IncomingBackLink />
      <div className="flex items-center justify-between mb-6">
        <PageHeading>Loved</PageHeading>
        {books.length > 0 && (
          <CoverSizeSlider size={coverSize} onChange={setCoverSize} min={coverMin} max={coverMax} />
        )}
      </div>

      {allEmpty ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">No loved books, authors, or series yet.</p>
          <Link to="/" className="text-sm text-oak hover:text-leather">
            Browse your library →
          </Link>
        </div>
      ) : (
        <>
          {/* Books — the historical cohort. Cover grid + cohort threading
              into BookDetail's prev/next. */}
          <section className="mb-12">
            <h2 className={`${sectionEyebrow} mb-4`}>Books</h2>
            {books.length > 0 && (
              <ErrorBanner message={bookError ? 'Failed to load loved books.' : null} onDismiss={dismissBookError} className="mb-4" />
            )}
            {loadingBooks ? (
              <GridSkeleton count={10} compact={compact} gridStyle={gridStyle} gridClassName={gridClassName} />
            ) : books.length === 0 && bookError ? (
              <div role="alert" className="text-warn text-sm">Failed to load loved books.</div>
            ) : books.length === 0 ? (
              <p className="text-sm text-neutral-600">No loved books yet — click the ♥ on any book card or detail page.</p>
            ) : (() => {
              const availableFormats = Array.from(new Set(books.map(b => b.format).filter(Boolean))).sort();
              const visible = formatFilter ? books.filter(b => b.format === formatFilter) : books;
              return (
                <>
                  {availableFormats.length > 1 && (
                    <div className="mb-4 flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setFormatFilter(null)}
                        aria-pressed={formatFilter == null}
                        className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                          formatFilter == null
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
                          onClick={() => setFormatFilter(formatFilter === f ? null : f)}
                          aria-pressed={formatFilter === f}
                          className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                            formatFilter === f
                              ? 'bg-binding/50 text-parchment border-binding/70'
                              : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                          }`}
                        >
                          {FORMAT_LABEL[f] ?? f}
                        </button>
                      ))}
                    </div>
                  )}
                  {visible.length === 0 ? (
                    <p className="text-sm text-neutral-600">
                      No loved {FORMAT_LABEL[formatFilter]?.toLowerCase() ?? formatFilter} books.
                    </p>
                  ) : (
                    <div className={gridClassName} style={gridStyle}>
                      {(() => {
                        const linkState = {
                          from: 'Loved',
                          fromPath: '/loved',
                          cohort: visible.map(b => ({ id: b.id, title: b.title })),
                        };
                        return visible.map(book => (
                          <BookCard key={book.id} book={book} onProgressUpdate={handleBookUpdate} compact={compact} linkState={linkState} />
                        ));
                      })()}
                    </div>
                  )}
                </>
              );
            })()}
          </section>

          {/* Authors — small portrait cards. No cover-size slider since
              author photos are independent of the books slider. */}
          <section className="mb-12">
            <h2 className={`${sectionEyebrow} mb-4`}>Authors</h2>
            {loadingAuthors ? (
              <p role="status" className="text-sm text-neutral-500">Loading…</p>
            ) : authorError ? (
              <div role="alert" className="text-warn text-sm">Failed to load loved authors.</div>
            ) : authors.length === 0 ? (
              <p className="text-sm text-neutral-600">No loved authors yet — click the ♥ on any author&apos;s page.</p>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {authors.map(a => (
                  <li key={a.id}>
                    <Link
                      to={`/authors/${a.id}`}
                      state={{ from: 'Loved', fromPath: '/loved' }}
                      className="group block"
                    >
                      <div className="aspect-[3/4] bg-neutral-800 rounded overflow-hidden shadow">
                        {a.photo_path ? (
                          <img src={a.photo_path} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover object-top transition-opacity group-hover:opacity-90" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900">
                            <span className="text-3xl font-bold text-neutral-500 select-none">{initialsFor(a.name)}</span>
                          </div>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-neutral-300 group-hover:text-parchment transition-colors truncate">{a.name}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Series — first-volume cover (already inlined by the server)
              plus the name and book count below. */}
          <section>
            <h2 className={`${sectionEyebrow} mb-4`}>Series</h2>
            {loadingSeries ? (
              <p role="status" className="text-sm text-neutral-500">Loading…</p>
            ) : seriesError ? (
              <div role="alert" className="text-warn text-sm">Failed to load loved series.</div>
            ) : series.length === 0 ? (
              <p className="text-sm text-neutral-600">No loved series yet — click the ♥ on any row of the <Link to="/series" className="text-neutral-400 hover:text-parchment transition-colors underline-offset-2 hover:underline">Series</Link> index.</p>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {series.map(s => (
                  <li key={s.name}>
                    <Link
                      to={`/browse/series/${encodeURIComponent(s.name)}`}
                      state={{ from: 'Loved', fromPath: '/loved' }}
                      className="group block"
                    >
                      <div className="aspect-[2/3] bg-neutral-800 rounded overflow-hidden shadow">
                        {s.cover_path ? (
                          <img src={s.cover_path} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition-opacity group-hover:opacity-90" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900 p-2">
                            <span className="text-2xl font-bold text-neutral-500 select-none text-center">{initialsFor(s.name)}</span>
                          </div>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-neutral-300 group-hover:text-parchment transition-colors truncate">{s.name}</p>
                      {s.book_count > 0 && (
                        <p className="text-xs text-neutral-600">{s.book_count} {s.book_count === 1 ? 'book' : 'books'}</p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
