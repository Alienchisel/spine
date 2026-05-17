import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../api.js';
import StarRating from '../components/StarRating.jsx';
import ListPicker from '../components/ListPicker.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import { realTagNames } from '../utils.js';
import ProgressSection from '../components/bookDetail/ProgressSection.jsx';
import ReadsSection from '../components/bookDetail/ReadsSection.jsx';
import StoriesSection from '../components/bookDetail/StoriesSection.jsx';
import MetadataList from '../components/bookDetail/MetadataList.jsx';
import EditionsSection from '../components/bookDetail/EditionsSection.jsx';
import ReadingLog from '../components/bookDetail/ReadingLog.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useLatest } from '../hooks/useLatest.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import { useSpineEvent } from '../hooks/useSpineEvent.js';

const STATUS_LABEL = { reading: 'Reading', finished: 'Finished', unread: 'Unread' };
const STATUS_COLOR = {
  reading:  'text-parchment bg-oak/30',
  finished: 'text-leather bg-binding/30',
  unread:   'text-neutral-400 bg-neutral-800',
};

// Same-origin Library referrer (any URL on this origin that starts at
// `/?` or is exactly `/`). Used to recover the filtered Library view
// when the user opened this BookDetail in a new tab — location.state
// doesn't transmit through new tabs but document.referrer does.
function libraryReferrerPath() {
  if (typeof document === 'undefined' || !document.referrer) return null;
  try {
    const ref = new URL(document.referrer);
    if (ref.origin !== window.location.origin) return null;
    if (ref.pathname !== '/') return null;
    return ref.pathname + ref.search;
  } catch {
    return null;
  }
}

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state: navState } = useLocation();
  const backLabel = navState?.from ?? 'Library';
  // navState wins (same-tab navigation carries the exact Library URL
  // we came from); document.referrer is the fallback for new-tab
  // opens where location.state is lost. Default to '/' if neither
  // applies (direct deep link / bookmark / typed URL).
  const backPath  = navState?.fromPath ?? libraryReferrerPath() ?? '/';
  const confirm = useConfirm();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [log, setLog] = useState([]);
  const [reads, setReads] = useState([]);
  const [descExpanded, setDescExpanded] = useState(false);
  const [ratingPrompt, setRatingPrompt] = useState(false);
  // In-flight lockouts for the action-column buttons. Without the sync
  // ref half, a fast double-click reads stale `book.loved` (etc.) before
  // the first PUT's response has landed, so both intents resolve to the
  // same target value and the toggle effectively no-ops the second click.
  // The PATCH is idempotent at the DB level but bumps updated_at twice
  // and adds noise to Recently updated. finishing's stakes are higher —
  // the finish transition can auto-insert a read row, so a duplicate
  // could land two reads. delete's window is tiny (button is disabled
  // and confirm() serialises modal input) but cheap to close.
  const loveGuard     = useActionGuard();
  const listGuard     = useActionGuard();
  const archiveGuard  = useActionGuard();
  const finishGuard   = useActionGuard();
  const deleteGuard   = useActionGuard();
  const [finishError, setFinishError] = useState(null);
  const [loadError, setLoadError] = useState(false);
  // Surfaces failures from the three quick actions in the action column
  // (loved/readlist toggles, rate). finishError is kept separate because
  // it has its own established render slot under the Mark-as-finished button.
  const [actionError, setActionError] = useState(null);
  // Reading-log fetches (initial mount + post-progress-save refresh) — kept
  // separate from actionError because logError renders above the ReadingLog
  // component on the right side of the page, distinct from the action column.
  const [logError, setLogError] = useState(null);
  // Reads (per-completion history) fetches — separate render slot, separate
  // state. Renders above ReadsSection.
  const [readsError, setReadsError] = useState(null);
  // Series-sibling fetch powers the prev/next nav between volumes. Failure
  // just hides the nav — small but tells the user why a book in a known
  // series shows no prev/next strip.
  const [seriesError, setSeriesError] = useState(null);
  // getShelfLocation failure used to set location=null, which is the same
  // state as "book genuinely has no shelf assignment" — indistinguishable
  // failure mode. This separates them.
  const [locationError, setLocationError] = useState(null);
  // Delete button sits at the bottom of the right column, far from
  // actionError's render slot in the action column. Separate state so the
  // failure message can render right next to the button that triggered it.
  const [deleteError, setDeleteError] = useState(null);

  // Stale-response guards. Quick clicking between books in a list could
  // otherwise let an older response from book A clobber the page for the
  // newly-loaded book B. Two independent gens because the second effect
  // re-fires on book?.id, which is downstream of the first effect's setBook.
  const idGuard   = useStaleGuard();
  const bookGuard = useStaleGuard();
  // Tracks the id from the previous render of the load effect. Lets us
  // distinguish a real navigation (new id → wipe visible state) from a
  // refresh-tick refetch at the same id (silently swap data, preserving
  // expanded description / rating prompt / scroll position). Mirrors
  // Library's lastFetchKeyRef pattern.
  const prevIdRef = useRef(null);
  // Bumped on every rating click so a slower-resolving earlier PUT can't
  // setBook over a faster-resolving later PUT (e.g. user clicks 5 then 3
  // and the 5 response lands last). Local-UI scoped — server-side last-
  // write-wins is unaffected and could still differ in edge cases.
  const ratingGuard = useStaleGuard();
  // Tracks the URL's current id every render so callbacks fired by child
  // components (e.g. ProgressSection.onChange after an async save) can
  // tell whether their result still belongs to the page being viewed.
  // Compared against `updated.id` rather than via the gen counters because
  // the child triggers its own out-of-band fetch — gen capture would need
  // to live inside the child.
  const latestIdRef = useLatest(id);
  const [seriesSiblings, setSeriesSiblings] = useState([]);
  const refreshTick = useRefreshTick();

  function loadReads() {
    // Capture the current id-epoch so a slow response can't clobber
    // the reads list for a book the user has since navigated away from.
    // (handleFinish and ReadsSection.onUpdate also call this; if the user
    // navigates mid-flight, idGuard bumps and this response is dropped.)
    const epoch = idGuard.current();
    setReadsError(null);
    api.getBookReads(id)
      .then(r => { if (idGuard.isFresh(epoch)) setReads(r); })
      .catch(() => { if (idGuard.isFresh(epoch)) setReadsError('Failed to load read history.'); });
  }

  useEffect(() => {
    const epoch = idGuard.next();
    const isIdChange = prevIdRef.current !== id;
    prevIdRef.current = id;
    // Only wipe visible state on a real navigation (id change). On a
    // refresh-tick refetch at the same id, the fetch resolutions below
    // atomically replace the data — wiping first would flash "Loading…"
    // and reset descExpanded / ratingPrompt every alt-tab roundtrip.
    if (isIdChange) {
      setLoading(true);
      setLoadError(false);
      setBook(null);
      setLog([]);
      setLogError(null);
      setReads([]);
      setReadsError(null);
      setLocation(null);
      setLocationError(null);
      setSeriesSiblings([]);
      setSeriesError(null);
      setActionError(null);
      setFinishError(null);
      setDeleteError(null);
      setRatingPrompt(false);
      setDescExpanded(false);
    }

    api.getBook(id)
      .then(b => {
        if (!idGuard.isFresh(epoch)) return;
        setBook(b);
        // Auto-finish from Library's progress quick-edit navigates here
        // with state.justFinished so the rating prompt — which would
        // otherwise vanish along with the unmounting BookCard — surfaces
        // on a surface that sticks. Only fire if we actually need a
        // rating; revisits of the same already-rated book stay quiet.
        if (navState?.justFinished && !b.rating) setRatingPrompt(true);
      })
      .catch(() => { if (idGuard.isFresh(epoch)) setLoadError(true); })
      .finally(() => { if (idGuard.isFresh(epoch)) setLoading(false); });
    api.getBookLog(id)
      .then(l => { if (idGuard.isFresh(epoch)) setLog(l); })
      .catch(() => { if (idGuard.isFresh(epoch)) setLogError('Failed to load reading log.'); });
    loadReads();
  }, [id, refreshTick]);

  useEffect(() => {
    if (!book?.id) return;
    const epoch = bookGuard.next();
    setLocationError(null);
    // Clear seriesError unconditionally — if the new book has no series,
    // we still need to wipe a stale seriesError from the previous book.
    // Was previously inside `if (book.series)` and so wouldn't fire when
    // navigating from a series-book (failed series load) to a standalone.
    setSeriesError(null);
    api.getShelfLocation(book.id)
      .then(loc => { if (bookGuard.isFresh(epoch)) setLocation(loc); })
      .catch(() => {
        if (!bookGuard.isFresh(epoch)) return;
        setLocation(null);
        setLocationError('Failed to load shelf location.');
      });
    if (book.series) {
      api.getBooks({ series: book.series, field: 'series', limit: 100 })
        .then(r => { if (bookGuard.isFresh(epoch)) setSeriesSiblings(r.books || []); })
        .catch(() => { if (bookGuard.isFresh(epoch)) setSeriesError('Failed to load series navigation.'); });
    }
  }, [book?.id]);

  // Helper for the four async handlers below — drops the response if the
  // user has navigated away to another book by the time the await resolves.
  // Without this, A's PATCH/PUT result would clobber state under B's URL.
  function isStillCurrent(reqId) {
    return String(reqId) === String(latestIdRef.current);
  }

  // Listen for palette-driven mutations on this book (toggle loved /
  // readlist / archive). The command palette fires its API call directly
  // and dispatches spine:book-mutated so the detail page can refresh
  // without a navigation. Same-id check guards against listening for
  // mutations on other books while this page is mounted (e.g. background
  // tabs sharing the same window).
  useSpineEvent('spine:book-mutated', (e) => {
    if (Number(e.detail?.id) !== Number(id)) return;
    // Stale-navigation guard: api.getBook is async, and the user may
    // have moved on to a different book before the response arrives.
    // Without the check, book A's data could land as `book` state on
    // book B's page. Mirrors the guards on every other async path
    // below.
    api.getBook(id)
      .then(b => { if (isStillCurrent(id)) setBook(b); })
      .catch(() => {});
  });

  // Both finishError and actionError render inside the action panel, so a
  // stale message from one handler can sit next to a successful action from
  // another. Each handler clears both on entry so the visible state always
  // reflects the most recent action — same shape as the Lists.jsx fix.
  async function toggleLoved() {
    if (!loveGuard.begin()) return;
    const reqId = book.id;
    setActionError(null);
    setFinishError(null);
    try {
      const updated = await api.patchBook(reqId, { loved: book.loved ? 0 : 1 });
      if (!isStillCurrent(reqId)) return;
      setBook(updated);
    } catch {
      if (!isStillCurrent(reqId)) return;
      setActionError('Failed to update loved');
    } finally {
      loveGuard.end();
    }
  }

  async function toggleReadlist() {
    if (!listGuard.begin()) return;
    const reqId = book.id;
    setActionError(null);
    setFinishError(null);
    try {
      const updated = await api.patchBook(reqId, { on_readlist: book.on_readlist ? 0 : 1 });
      if (!isStillCurrent(reqId)) return;
      setBook(updated);
    } catch {
      if (!isStillCurrent(reqId)) return;
      setActionError('Failed to update readlist');
    } finally {
      listGuard.end();
    }
  }

  async function toggleArchived() {
    if (!archiveGuard.begin()) return;
    const reqId = book.id;
    setActionError(null);
    setFinishError(null);
    try {
      const updated = await api.patchBook(reqId, { archived: book.archived ? 0 : 1 });
      if (!isStillCurrent(reqId)) return;
      setBook(updated);
    } catch {
      if (!isStillCurrent(reqId)) return;
      setActionError('Failed to update archive state');
    } finally {
      archiveGuard.end();
    }
  }

  async function handleFinish() {
    if (!finishGuard.begin()) return;
    const reqId = book.id;
    setFinishError(null);
    setActionError(null);
    try {
      const today = new Date().toLocaleDateString('en-CA');
      // Previously-owned books are typically a historical read with an
      // unknown finish date — defaulting to today would silently fabricate
      // one. Leave null so the user can fill it in if they remember.
      const dateFinished = book.date_finished
        || (book.previously_owned ? null : today);
      const updated = await api.updateBook(reqId, {
        ...book,
        status: 'finished',
        date_finished: dateFinished,
        tags: realTagNames(book.tags),
      });
      if (!isStillCurrent(reqId)) return;
      setBook(updated);
      if (!book.rating) setRatingPrompt(true);
      loadReads();
    } catch {
      if (!isStillCurrent(reqId)) return;
      setFinishError('Failed to save — please try again');
    } finally {
      // Always resets — it's a button-state flag, leaving it busy after
      // navigation just disables a button that's now unmounted.
      finishGuard.end();
    }
  }

  async function handleRate(rating) {
    const reqId = book.id;
    setActionError(null);
    setFinishError(null);
    const epoch = ratingGuard.next();
    try {
      const updated = await api.updateBook(reqId, {
        ...book,
        rating,
        tags: realTagNames(book.tags),
      });
      if (!isStillCurrent(reqId) || !ratingGuard.isFresh(epoch)) return;
      setBook(updated);
      setRatingPrompt(false);
    } catch {
      if (!isStillCurrent(reqId) || !ratingGuard.isFresh(epoch)) return;
      setActionError('Failed to save rating');
    }
  }

  async function handleDelete() {
    if (deleteGuard.isBusy()) return;
    if (!await confirm(`Delete "${book.title}"?`)) return;
    if (!deleteGuard.begin()) return;
    const reqId = id;
    setDeleteError(null);
    try {
      await api.deleteBook(reqId);
      // Return to wherever the user came from — Shelves, Loved, etc. —
      // not the default Library, since the deleted book is gone from
      // every surface anyway.
      navigate(backPath);
    } catch {
      if (!isStillCurrent(reqId)) return;
      setDeleteError('Failed to delete book. Please try again.');
      // Only reset on failure — on success the component unmounts via
      // navigate, so leaving the flag latched is moot.
      deleteGuard.end();
    }
  }

  // BrowsePage back-link state for outgoing tag/author/etc links — returning
  // from /browse/<field>/<value> lands back on this book rather than the
  // default Library. Title is the human label; pathname is the round-trip.
  // Memoised so every child Link's `state` prop keeps a stable reference
  // between renders when title/id don't change. Declared above the early
  // returns so the hook order stays consistent (the empty-fallback values
  // are never observed — the guards below skip rendering anything that
  // would read them).
  const bookFromState = useMemo(() => ({
    from:     book?.title ?? '',
    fromPath: `/books/${id}`,
  }), [book?.title, id]);

  if (loading) return <div role="status" className="text-neutral-700 text-sm">Loading…</div>;
  if (!book) return <div className="text-neutral-600 text-sm">{loadError ? 'Failed to load book.' : 'Book not found.'}</div>;

  return (
    <div className="max-w-2xl">
      <Link to={backPath} className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        ← {backLabel}
      </Link>

      <div className="flex gap-8 sm:gap-10">
        <div className="flex-shrink-0 sticky top-[4.5rem] self-start">
          <div className={`relative w-[230px] ${book.format === 'audiobook' ? 'h-[230px]' : 'h-[345px]'} bg-neutral-800 rounded overflow-hidden shadow-2xl ring-1 ring-white/5`}>
            {book.cover_path ? (
              <img src={book.cover_path} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-br from-neutral-700 to-neutral-900 gap-3">
                <span className="text-6xl font-bold text-neutral-500 select-none leading-none">
                  {(book.title.replace(/^(the|a|an)\s+/i, '') || book.title)[0].toUpperCase()}
                </span>
                <span className="text-xs text-neutral-500 font-medium leading-tight text-center">{book.title}</span>
              </div>
            )}
            {/* Spine-hinge highlight: faint light catching the leftmost edge,
                suggesting the cover curves slightly toward an unseen spine. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-white/15 to-transparent" />
          </div>

          <div className="mt-3 border border-neutral-800 rounded-lg overflow-hidden">
            <div className="flex justify-around items-start py-3 px-2">
              <button
                onClick={toggleLoved}
                disabled={loveGuard.busy}
                className={`flex flex-col items-center gap-1.5 transition-colors disabled:opacity-50 ${book.loved ? 'text-red-400' : 'text-neutral-600 hover:text-neutral-300'}`}
                title={book.loved ? 'Remove from loved' : 'Mark as loved'}
                aria-pressed={!!book.loved}
              >
                <span className="text-2xl leading-none">{book.loved ? '♥' : '♡'}</span>
                <span className="text-[10px] uppercase tracking-wider">Loved</span>
              </button>
              <button
                onClick={toggleReadlist}
                disabled={listGuard.busy}
                className={`flex flex-col items-center gap-1.5 transition-colors disabled:opacity-50 ${book.on_readlist ? 'text-sky-400' : 'text-neutral-600 hover:text-neutral-300'}`}
                title={book.on_readlist ? 'Remove from readlist' : 'Add to readlist'}
                aria-pressed={!!book.on_readlist}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
                  <path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v12.5a.75.75 0 0 1-1.18.617L8 12.21l-4.82 3.657A.75.75 0 0 1 2 15.25V2.75Z" />
                </svg>
                <span className="text-[10px] uppercase tracking-wider">Readlist</span>
              </button>
              <div className="flex flex-col items-center gap-1.5 text-neutral-600">
                <ListPicker bookId={book.id} iconClassName="w-5 h-5" />
                <span className="text-[10px] uppercase tracking-wider pointer-events-none">Lists</span>
              </div>
              <button
                onClick={toggleArchived}
                disabled={archiveGuard.busy}
                className={`flex flex-col items-center gap-1.5 transition-colors disabled:opacity-50 ${book.archived ? 'text-amber-500' : 'text-neutral-600 hover:text-neutral-300'}`}
                title={book.archived ? 'Restore from archive' : 'Archive — hide from active library'}
                aria-pressed={!!book.archived}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
                  <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Z" />
                  <path fillRule="evenodd" d="M2.875 7a.5.5 0 0 0-.5.5v5.625A1.875 1.875 0 0 0 4.25 15h7.5a1.875 1.875 0 0 0 1.875-1.875V7.5a.5.5 0 0 0-.5-.5h-10.25Zm3.625 2.5a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                </svg>
                <span className="text-[10px] uppercase tracking-wider">{book.archived ? 'Archived' : 'Archive'}</span>
              </button>
            </div>
            {book.status === 'reading' && (
              <div className="border-t border-neutral-800 py-2.5 px-3">
                <button
                  onClick={handleFinish}
                  disabled={finishGuard.busy}
                  className="w-full text-xs text-neutral-500 hover:text-parchment disabled:opacity-40 disabled:cursor-default transition-colors text-center"
                >
                  {finishGuard.busy ? 'Saving…' : 'Mark as finished'}
                </button>
                {finishError && <p role="alert" className="text-[10px] text-warn text-center mt-1">{finishError}</p>}
              </div>
            )}
            <div className="border-t border-neutral-800 py-3 px-2">
              <p className="text-[10px] uppercase tracking-wider text-neutral-600 text-center mb-2.5">
                {ratingPrompt ? 'How was it?' : 'Rate'}
              </p>
              <div className="flex justify-center">
                <StarRating value={book.rating} onChange={handleRate} size="text-3xl" />
              </div>
              {ratingPrompt && !book.rating && (
                <div className="text-center mt-2">
                  <button onClick={() => setRatingPrompt(false)} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
                    skip
                  </button>
                </div>
              )}
              {book.rating && !ratingPrompt && (
                <p className="text-center text-xs text-neutral-600 mt-2">{book.rating} / 5</p>
              )}
            </div>
            {actionError && (
              <div className="border-t border-neutral-800 py-2 px-3">
                <p role="alert" className="text-[10px] text-warn text-center">{actionError}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h1 className="text-2xl font-bold text-white leading-tight">
              {book.title}
              {book.archived ? (
                <span className="ml-2 align-middle text-[10px] uppercase tracking-wider text-amber-500/80 font-normal border border-amber-500/30 rounded px-1.5 py-0.5">
                  Archived
                </span>
              ) : null}
            </h1>
            <div className="flex items-center gap-2 flex-shrink-0 pt-1">
              <span className="text-xs text-neutral-700 tabular-nums" title="Book ID">#{book.id}</span>
              <span className="text-neutral-800">·</span>
              <Link
                to={`/books/${book.id}/edit`}
                state={navState}
                className="text-sm text-neutral-500 hover:text-neutral-200 transition-colors"
              >
                Edit
              </Link>
            </div>
          </div>
          {(() => {
            // Pen-name aliases: same person, different byline. The
            // "also writes as" line surfaces here so a Bronze Age
            // Pervert page links to a Costin Alamariu page (and vice
            // versa) without forcing one canonical name.
            const seenIds = new Set(book.authors?.map(a => a.id) || []);
            const aliases = [];
            for (const a of book.authors || []) {
              for (const al of a.aliases || []) {
                if (seenIds.has(al.id)) continue;
                seenIds.add(al.id);
                aliases.push(al);
              }
            }
            const bylineMb = aliases.length ? 'mb-1' : 'mb-5';
            return (
              <>
                {book.authors?.length > 0 && (
                  <p className={`text-neutral-400 text-base ${bylineMb}`}>
                    {book.authors.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && <span className="text-neutral-600">{i === book.authors.length - 1 ? ' & ' : ', '}</span>}
                        <Link to={`/authors/${a.id}`} state={bookFromState} className="hover:text-neutral-200 transition-colors">
                          {a.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
                {aliases.length > 0 && (
                  <p className="text-neutral-600 text-xs mb-5">
                    also writes as{' '}
                    {aliases.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && (i === aliases.length - 1 ? ' & ' : ', ')}
                        <Link to={`/authors/${a.id}`} state={bookFromState} className="hover:text-neutral-400 transition-colors">
                          {a.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </>
            );
          })()}

          {seriesError && (
            <p role="alert" className="text-xs text-warn mb-5 -mt-2">{seriesError}</p>
          )}
          {(() => {
            if (seriesSiblings.length < 2) return null;
            // Series nav means "next volume", not "next sibling row." When two
            // books share the same series_number (e.g. M&C in two narrator
            // recordings) the array-index approach would point "next" at the
            // duplicate edition instead of advancing to volume N+1. Compute
            // prev/next directly from series_number, skipping any sibling at
            // the same volume slot. Cross-edition switching belongs in the
            // EditionsSection below, not in this nav.
            const cur = book.series_number;
            let prev = null, next = null;
            if (cur != null) {
              const numbered = seriesSiblings.filter(b => b.series_number != null);
              const lower  = numbered.filter(b => b.series_number < cur);
              const higher = numbered.filter(b => b.series_number > cur);
              // Tie-break ties at the same series_number by lower id so the
              // chosen sibling is stable across reloads regardless of fetch
              // order.
              const cmpAsc  = (a, b) => a.series_number - b.series_number || a.id - b.id;
              const cmpDesc = (a, b) => b.series_number - a.series_number || a.id - b.id;
              prev = lower.sort(cmpDesc)[0]  ?? null;
              next = higher.sort(cmpAsc)[0]  ?? null;
            } else {
              // Unnumbered current book: fall back to the original
              // array-index nav so we still surface SOME prev/next instead
              // of nothing. Order is whatever the backend's series query
              // returned (no clean canonical order without numbers).
              const idx = seriesSiblings.findIndex(b => b.id === book.id);
              prev = idx > 0 ? seriesSiblings[idx - 1] : null;
              next = idx >= 0 && idx < seriesSiblings.length - 1 ? seriesSiblings[idx + 1] : null;
            }
            if (!prev && !next) return null;
            return (
              <div className="flex items-center justify-between text-xs text-neutral-600 mb-5 -mt-2">
                {prev ? (() => {
                  const prevLabel = `${prev.series_number != null ? `#${prev.series_number} ` : ''}${prev.title}`;
                  return (
                    <Link to={`/books/${prev.id}`} state={navState} title={prevLabel} className="hover:text-neutral-400 transition-colors flex items-center gap-1 min-w-0">
                      <span className="flex-shrink-0">←</span>
                      <span className="truncate">{prevLabel}</span>
                    </Link>
                  );
                })() : <span />}
                {next && (() => {
                  const nextLabel = `${next.series_number != null ? `#${next.series_number} ` : ''}${next.title}`;
                  return (
                    <Link to={`/books/${next.id}`} state={navState} title={nextLabel} className="hover:text-neutral-400 transition-colors flex items-center gap-1 min-w-0 ml-4">
                      <span className="truncate text-right">{nextLabel}</span>
                      <span className="flex-shrink-0">→</span>
                    </Link>
                  );
                })()}
              </div>
            );
          })()}

          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[book.status]}`}>
              {STATUS_LABEL[book.status]}
            </span>
            {Boolean(book.owned) && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full text-parchment bg-binding/60">
                Owned
              </span>
            )}
            {!book.owned && Boolean(book.previously_owned) && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full text-neutral-400 bg-neutral-800">
                Previously owned
              </span>
            )}
            {Boolean(book.is_custom) && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full text-leather bg-neutral-800">
                ✦ Custom
              </span>
            )}
          </div>

          {book.status === 'reading' && (
            <ProgressSection book={book} log={log} onChange={(updated) => {
              // ProgressSection's save resolved — but the user may have
              // navigated to another book in the meantime. Drop the
              // result if its id doesn't match the URL anymore.
              if (String(updated.id) !== String(latestIdRef.current)) return;
              setBook(updated);
              setLogError(null);
              const reqId = id;
              api.getBookLog(reqId)
                .then(l => { if (String(reqId) === String(latestIdRef.current)) setLog(l); })
                .catch(() => { if (String(reqId) === String(latestIdRef.current)) setLogError('Failed to refresh reading log.'); });
            }} />
          )}

          {book.description && (() => {
            const long = book.description.length > 400;
            return (
              <div className="mb-6">
                <div className={`text-neutral-400 text-sm leading-relaxed prose-sm prose-invert prose-neutral max-w-none
                  [&_strong]:text-neutral-300 [&_em]:text-neutral-400 [&_p]:mb-2 [&_p:last-child]:mb-0
                  ${long && !descExpanded ? 'line-clamp-4' : ''}`}>
                  <ReactMarkdown>{book.description}</ReactMarkdown>
                </div>
                {long && (
                  <button
                    onClick={() => setDescExpanded(e => !e)}
                    className="mt-1 text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
                  >
                    {descExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            );
          })()}

          {locationError && <p role="alert" className="text-xs text-warn mb-2">{locationError}</p>}
          <MetadataList book={book} location={location} linkState={bookFromState} />

          {book.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {book.tags.map((t) => (
                <Link
                  key={t.virtual ? `v:${t.name}` : t.id}
                  to={`/browse/tag/${encodeURIComponent(t.name)}`}
                  state={bookFromState}
                  className={t.virtual
                    ? 'text-xs border border-neutral-700 text-neutral-500 px-2.5 py-1 rounded-full hover:border-neutral-500 hover:text-neutral-300 transition-colors'
                    : 'text-xs bg-neutral-800 text-neutral-400 px-2.5 py-1 rounded-full hover:bg-neutral-700 hover:text-neutral-200 transition-colors'}
                >
                  {t.name}
                </Link>
              ))}
            </div>
          )}

          <EditionsSection book={book} linkState={navState} onChange={(updated) => {
            // Same stale-navigation guard as ProgressSection — the
            // edition link/unlink calls are async; if the user has
            // navigated to another book in the meantime, drop the result
            // instead of writing it onto the new book's view.
            if (String(updated.id) !== String(latestIdRef.current)) return;
            setBook(updated);
          }} />

          {(book.status !== 'unread' || reads.length > 0 || readsError) && (
            <>
              {readsError && <p role="alert" className="text-xs text-warn mb-2">{readsError}</p>}
              <ReadsSection
                bookId={book.id}
                reads={reads}
                isFinished={book.status === 'finished'}
                onUpdate={loadReads}
                onBookUpdate={(updated) => {
                  // Mirrors the ProgressSection.onChange guard — if the user
                  // navigated to another book while the rereadBook PATCH was
                  // in flight, drop the response instead of writing book A's
                  // data into book B's view.
                  if (String(updated.id) !== String(latestIdRef.current)) return;
                  setBook(updated);
                }}
              />
            </>
          )}

          {/* Stories (collection table-of-contents). Surface only on
              books tagged Stories, Anthology, or Compilation — or any
              book that already has stories attached, so a user can
              still see/edit them after retagging. Compilation extends
              the same shape to nonfiction collected-works / essay
              volumes, swapping the user-visible noun from "story" to
              "entry" since the items are essays or books, not shorts. */}
          {(() => {
            const tagNames = (book.tags || []).map(t => t.name);
            const isCollection = tagNames.includes('Stories') || tagNames.includes('Anthology') || tagNames.includes('Compilation');
            const stories = book.stories || [];
            if (!isCollection && stories.length === 0) return null;
            const noun = tagNames.includes('Compilation') && !tagNames.includes('Stories') && !tagNames.includes('Anthology') ? 'entry' : 'story';
            return (
              <StoriesSection
                bookId={book.id}
                stories={stories}
                bookAuthors={book.authors || []}
                noun={noun}
                onUpdate={() => api.getBook(book.id).then(b => {
                  if (String(b.id) !== String(latestIdRef.current)) return;
                  // When the last story-finish auto-rolls the parent
                  // collection to status='finished', surface the rating
                  // prompt the same way an explicit finish would. Compares
                  // the prior `book` snapshot held in closure to the
                  // freshly-fetched `b`.
                  if (book && book.status !== 'finished' && b.status === 'finished' && !b.rating) {
                    setRatingPrompt(true);
                  }
                  setBook(b);
                })}
              />
            );
          })()}

          {(book.status === 'finished' || book.read_count > 0) && book.review && (
            <div className="border-t border-neutral-800 pt-5">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Review</p>
              <div className="text-neutral-300 text-sm leading-relaxed prose-sm prose-invert prose-neutral max-w-none
                [&_strong]:text-neutral-200 [&_em]:text-neutral-400 [&_p]:mb-2 [&_p:last-child]:mb-0">
                <ReactMarkdown>{book.review}</ReactMarkdown>
              </div>
            </div>
          )}

          {book.notes && (
            <div className="border-t border-neutral-800 pt-5">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Notes</p>
              <div className="text-neutral-400 text-sm leading-relaxed prose-sm prose-invert prose-neutral max-w-none
                [&_strong]:text-neutral-300 [&_em]:text-neutral-400 [&_p]:mb-2 [&_p:last-child]:mb-0">
                <ReactMarkdown>{book.notes}</ReactMarkdown>
              </div>
            </div>
          )}

          {logError && <p role="alert" className="text-xs text-warn mb-2">{logError}</p>}
          <ReadingLog
            log={log}
            isAudiobook={book.format === 'audiobook'}
            status={book.status}
            pageCount={book.page_count}
          />

          <div className="mt-8 pt-6 border-t border-neutral-800/60">
            <button
              onClick={handleDelete}
              disabled={deleteGuard.busy}
              className="text-sm text-neutral-600 hover:text-warn disabled:opacity-50 disabled:cursor-wait transition-colors"
            >
              {deleteGuard.busy ? 'Deleting…' : 'Delete'}
            </button>
            {deleteError && <p role="alert" className="text-xs text-warn mt-2">{deleteError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
