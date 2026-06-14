import { Link } from 'react-router-dom';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';
import CoverSizeSlider from '../components/CoverSizeSlider.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { GridSkeleton } from '../components/Skeleton.jsx';
import PageHeading from '../components/PageHeading.jsx';
import { sectionEyebrow } from '../components/textStyles.js';
import { useFreshFetch } from '../hooks/useFreshFetch.js';
import { useSpineEvent } from '../hooks/useSpineEvent.js';
import { useCoverSize } from '../hooks/useCoverSize.js';
import { initialsFor } from '../utils.js';

// /loved is the home of every loved entity in the library — books at
// the top (the historical Loved view), then authors, then series.
// Each section is independent: a flaky author fetch can't take down
// the books grid, and an empty section still renders its own
// "no loved X yet" hint instead of collapsing the page.
export default function Loved() {
  // Three independent hooks rather than one Promise.all so a flaky
  // section can't take down the others — each surface fails alone.
  // limit=200 on books is the /api/books cap. Without it, the server
  // default of 50 truncates the cohort that flows into BookDetail's
  // prev/next.
  const {
    data: books,
    setData: setBooks,
    loading: loadingBooks,
    error: bookError,
    setError: setBookError,
  } = useFreshFetch(
    () => api.getBooks({ tab: 'loved', limit: 200 }).then(d => d.books),
    [],
    { initialData: [] },
  );
  const {
    data: authors,
    loading: loadingAuthors,
    error: authorError,
  } = useFreshFetch(
    () => api.getAuthors({ loved: 1 }).then(rows => Array.isArray(rows) ? rows : []),
    [],
    { initialData: [] },
  );
  const {
    data: series,
    loading: loadingSeries,
    error: seriesError,
  } = useFreshFetch(
    () => api.getSeries({ loved: 1 }).then(rows => Array.isArray(rows) ? rows : []),
    [],
    { initialData: [] },
  );
  const { size: coverSize, setSize: setCoverSize, compact, gridStyle, gridClassName, MIN: coverMin, MAX: coverMax } = useCoverSize();

  // Refetch-and-swap on book mutations from other surfaces (MoreMenu's
  // Location picker, palette toggles, etc.). Only the books grid here
  // renders cards with MoreMenus; authors/series sections render their
  // own portrait/spine cards that don't need swapping. spine:book-deleted
  // filters in place — the loved tab is naturally going to drop the
  // book from its server-side result on next mount anyway, this just
  // keeps the local view consistent until then. Mirrors Library shape.
  useSpineEvent('spine:book-mutated', (e) => {
    const id = Number(e.detail?.id);
    if (!id) return;
    api.getBook(id)
      .then(updated => {
        setBooks(prev => prev.map(b => b.id === id ? updated : b));
      })
      .catch(() => {});
  });
  useSpineEvent('spine:book-deleted', (e) => {
    const id = Number(e.detail?.id);
    if (!id) return;
    setBooks(prev => prev.filter(b => b.id !== id));
  });

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
              <ErrorBanner message={bookError ? 'Failed to load loved books.' : null} onDismiss={() => setBookError(null)} className="mb-4" />
            )}
            {loadingBooks ? (
              <GridSkeleton count={10} compact={compact} gridStyle={gridStyle} gridClassName={gridClassName} />
            ) : books.length === 0 && bookError ? (
              <div role="alert" className="text-warn text-sm">Failed to load loved books.</div>
            ) : books.length === 0 ? (
              <p className="text-sm text-neutral-600">No loved books yet — click the ♥ on any book card or detail page.</p>
            ) : (
              <div className={gridClassName} style={gridStyle}>
                {(() => {
                  const linkState = {
                    from: 'Loved',
                    fromPath: '/loved',
                    cohort: books.map(b => ({ id: b.id, title: b.title })),
                  };
                  return books.map(book => (
                    <BookCard key={book.id} book={book} onProgressUpdate={handleBookUpdate} compact={compact} linkState={linkState} />
                  ));
                })()}
              </div>
            )}
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
