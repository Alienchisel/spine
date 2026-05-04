import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../api.js';
import StarRating from '../components/StarRating.jsx';
import ListPicker from '../components/ListPicker.jsx';
import { useConfirm } from '../components/ConfirmModal.jsx';
import { realTagNames } from '../utils.js';
import ProgressSection from '../components/bookDetail/ProgressSection.jsx';
import ReadsSection from '../components/bookDetail/ReadsSection.jsx';
import MetadataList from '../components/bookDetail/MetadataList.jsx';
import ReadingLog from '../components/bookDetail/ReadingLog.jsx';

const STATUS_LABEL = { reading: 'Reading', paused: 'Paused', finished: 'Finished', unread: 'Unread' };
const STATUS_COLOR = {
  reading:  'text-parchment bg-oak/30',
  paused:   'text-neutral-300 bg-neutral-800',
  finished: 'text-leather bg-binding/30',
  unread:   'text-neutral-400 bg-neutral-800',
};

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [log, setLog] = useState([]);
  const [reads, setReads] = useState([]);
  const [descExpanded, setDescExpanded] = useState(false);
  const [ratingPrompt, setRatingPrompt] = useState(false);
  const [finishing, setFinishing] = useState(false);
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
  const [seriesSiblings, setSeriesSiblings] = useState([]);

  function loadReads() {
    setReadsError(null);
    api.getBookReads(id).then(setReads).catch(() => setReadsError('Failed to load read history.'));
  }

  useEffect(() => {
    api.getBook(id).then(setBook).catch(() => setLoadError(true)).finally(() => setLoading(false));
    setLogError(null);
    api.getBookLog(id).then(setLog).catch(() => setLogError('Failed to load reading log.'));
    loadReads();
    setDescExpanded(false);
    setSeriesSiblings([]);
  }, [id]);

  useEffect(() => {
    if (!book?.id) return;
    api.getShelfLocation(book.id).then(setLocation).catch(() => setLocation(null));
    if (book.series) {
      setSeriesError(null);
      api.getBooks({ series: book.series, field: 'series', limit: 100 })
        .then(r => setSeriesSiblings(r.books || []))
        .catch(() => setSeriesError('Failed to load series navigation.'));
    }
  }, [book?.id]);

  async function toggleLoved() {
    setActionError(null);
    try {
      const updated = await api.patchBook(book.id, { loved: book.loved ? 0 : 1 });
      setBook(updated);
    } catch {
      setActionError('Failed to update loved');
    }
  }

  async function toggleReadlist() {
    setActionError(null);
    try {
      const updated = await api.patchBook(book.id, { on_readlist: book.on_readlist ? 0 : 1 });
      setBook(updated);
    } catch {
      setActionError('Failed to update readlist');
    }
  }

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    setFinishError(null);
    try {
      const today = new Date().toLocaleDateString('en-CA');
      const dateFinished = book.date_finished || today;
      const updated = await api.updateBook(book.id, {
        ...book,
        status: 'finished',
        date_finished: dateFinished,
        tags: realTagNames(book.tags),
      });
      setBook(updated);
      if (!book.rating) setRatingPrompt(true);
      loadReads();
    } catch {
      setFinishError('Failed to save — please try again');
    } finally {
      setFinishing(false);
    }
  }

  async function handleRate(rating) {
    setActionError(null);
    try {
      const updated = await api.updateBook(book.id, {
        ...book,
        rating,
        tags: realTagNames(book.tags),
      });
      setBook(updated);
      setRatingPrompt(false);
    } catch {
      setActionError('Failed to save rating');
    }
  }

  async function handleDelete() {
    if (!await confirm(`Delete "${book.title}"?`)) return;
    try {
      await api.deleteBook(id);
      navigate('/');
    } catch {
      alert('Failed to delete — please try again');
    }
  }

  if (loading) return <div className="text-neutral-700 text-sm">Loading…</div>;
  if (!book) return <div className="text-neutral-600 text-sm">{loadError ? 'Failed to load book.' : 'Book not found.'}</div>;

  return (
    <div className="max-w-2xl">
      <Link to="/" className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        ← Library
      </Link>

      <div className="flex gap-8 sm:gap-10">
        <div className="flex-shrink-0 sticky top-[4.5rem] self-start">
          <div className={`relative w-[230px] ${book.format === 'audiobook' ? 'h-[230px]' : 'h-[345px]'} bg-neutral-800 rounded overflow-hidden shadow-2xl ring-1 ring-white/5`}>
            {book.cover_path ? (
              <img src={book.cover_path} alt={book.title} className="w-full h-full object-cover" />
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
                className={`flex flex-col items-center gap-1.5 transition-colors ${book.loved ? 'text-red-400' : 'text-neutral-600 hover:text-neutral-300'}`}
                title={book.loved ? 'Remove from loved' : 'Mark as loved'}
              >
                <span className="text-2xl leading-none">{book.loved ? '♥' : '♡'}</span>
                <span className="text-[10px] uppercase tracking-wider">Loved</span>
              </button>
              <button
                onClick={toggleReadlist}
                className={`flex flex-col items-center gap-1.5 transition-colors ${book.on_readlist ? 'text-sky-400' : 'text-neutral-600 hover:text-neutral-300'}`}
                title={book.on_readlist ? 'Remove from readlist' : 'Add to readlist'}
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
            </div>
            {(book.status === 'reading' || book.status === 'paused') && (
              <div className="border-t border-neutral-800 py-2.5 px-3">
                <button
                  onClick={handleFinish}
                  disabled={finishing}
                  className="w-full text-xs text-neutral-500 hover:text-parchment disabled:opacity-40 disabled:cursor-default transition-colors text-center"
                >
                  {finishing ? 'Saving…' : 'Mark as finished'}
                </button>
                {finishError && <p className="text-[10px] text-warn text-center mt-1">{finishError}</p>}
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
                <p className="text-[10px] text-warn text-center">{actionError}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h1 className="text-2xl font-bold text-white leading-tight">{book.title}</h1>
            <Link
              to={`/books/${book.id}/edit`}
              className="text-sm text-neutral-500 hover:text-neutral-200 transition-colors flex-shrink-0 pt-1"
            >
              Edit
            </Link>
          </div>
          {book.authors?.length > 0 && (
            <p className="text-neutral-400 text-base mb-5">
              {book.authors.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && <span className="text-neutral-600">{i === book.authors.length - 1 ? ' & ' : ', '}</span>}
                  <Link to={`/browse/author/${encodeURIComponent(a.name)}`} className="hover:text-neutral-200 transition-colors">
                    {a.name}
                  </Link>
                </span>
              ))}
            </p>
          )}

          {seriesError && (
            <p className="text-xs text-warn mb-5 -mt-2">{seriesError}</p>
          )}
          {(() => {
            if (seriesSiblings.length < 2) return null;
            const idx = seriesSiblings.findIndex(b => b.id === book.id);
            const prev = idx > 0 ? seriesSiblings[idx - 1] : null;
            const next = idx >= 0 && idx < seriesSiblings.length - 1 ? seriesSiblings[idx + 1] : null;
            if (!prev && !next) return null;
            return (
              <div className="flex items-center justify-between text-xs text-neutral-600 mb-5 -mt-2">
                {prev ? (
                  <Link to={`/books/${prev.id}`} className="hover:text-neutral-400 transition-colors flex items-center gap-1 min-w-0">
                    <span className="flex-shrink-0">←</span>
                    <span className="truncate">{prev.series_number != null ? `#${prev.series_number} ` : ''}{prev.title}</span>
                  </Link>
                ) : <span />}
                {next && (
                  <Link to={`/books/${next.id}`} className="hover:text-neutral-400 transition-colors flex items-center gap-1 min-w-0 ml-4">
                    <span className="truncate text-right">{next.series_number != null ? `#${next.series_number} ` : ''}{next.title}</span>
                    <span className="flex-shrink-0">→</span>
                  </Link>
                )}
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

          {(book.status === 'reading' || book.status === 'paused') && (
            <ProgressSection book={book} log={log} onChange={(updated) => {
              setBook(updated);
              setLogError(null);
              api.getBookLog(id).then(setLog).catch(() => setLogError('Failed to refresh reading log.'));
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

          <MetadataList book={book} location={location} />

          {book.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {book.tags.map((t) => (
                <Link
                  key={t.virtual ? `v:${t.name}` : t.id}
                  to={`/browse/tag/${encodeURIComponent(t.name)}`}
                  className={t.virtual
                    ? 'text-xs border border-neutral-700 text-neutral-500 px-2.5 py-1 rounded-full hover:border-neutral-500 hover:text-neutral-300 transition-colors'
                    : 'text-xs bg-neutral-800 text-neutral-400 px-2.5 py-1 rounded-full hover:bg-neutral-700 hover:text-neutral-200 transition-colors'}
                >
                  {t.name}
                </Link>
              ))}
            </div>
          )}

          {(book.status !== 'unread' || reads.length > 0 || readsError) && (
            <>
              {readsError && <p className="text-xs text-warn mb-2">{readsError}</p>}
              <ReadsSection
                bookId={book.id}
                reads={reads}
                isFinished={book.status === 'finished'}
                onUpdate={loadReads}
                onBookUpdate={setBook}
              />
            </>
          )}

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

          {logError && <p className="text-xs text-warn mb-2">{logError}</p>}
          <ReadingLog log={log} isAudiobook={book.format === 'audiobook'} />

          <div className="mt-8 pt-6 border-t border-neutral-800/60">
            <button
              onClick={handleDelete}
              className="text-sm text-neutral-600 hover:text-warn transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
