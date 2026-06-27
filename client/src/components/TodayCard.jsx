import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { api } from '../api.js';
import { initialsFor } from '../utils.js';
import BookRef from './bookDetail/BookRef.jsx';
import { TodayCardSkeleton } from './Skeleton.jsx';

// v0 of the daily "Today" card — three deterministic card types
// (loved_resurface / slow_burn / recent_acquisition) computed by
// /api/today/card. Lives on the dedicated /today route now (1.218.0);
// the dismiss-by-localStorage affordance from the original Library-
// inline placement is gone because the card is the destination here,
// not an intrusion on a browsing surface. Future card types
// (Connection / Reading Path / Author Spotlight) plug into the same
// component as the server gains more cohort logic.

const TYPE_LABEL = {
  loved_resurface: {
    label:       'A book you loved',
    accentClass: 'text-rose-400/80',
  },
  slow_burn: {
    label:       'Pace check',
    accentClass: 'text-amber-400/80',
  },
  recent_acquisition: {
    label:       'You just bought this',
    accentClass: 'text-sky-400/80',
  },
  forgotten_readlist: {
    label:       'Buried in the queue',
    accentClass: 'text-sky-400/80',
  },
  author_barely_opened: {
    label:       'Barely opened',
    accentClass: 'text-violet-400/80',
  },
  loved_author_followup: {
    // Pink instead of rose — same warm-loved register but visually
    // distinct from loved_resurface so the two loved-adjacent types
    // don't read as the same card on a quick glance.
    label:       'More by an author you loved',
    accentClass: 'text-pink-400/80',
  },
  series_next_volume: {
    // Green for "continue the journey" — picks up the growth /
    // progression register, distinct from emerald (reading_path) so
    // the two emerald-family accents don't blur, and from pink /
    // rose (the loved family) since this is a continuation not a
    // sentiment.
    label:       'Next in the series',
    accentClass: 'text-green-400/80',
  },
  anniversary: {
    // Orange for the calendar / festivity register — warm but
    // distinct from amber (slow_burn) so the two warm accents don't
    // collide.
    label:       'An anniversary',
    accentClass: 'text-orange-400/80',
  },
  author_anniversary: {
    // Fuchsia for the person/author-shaped festivity — distinct from
    // book anniversary's orange so the two anniversary cards don't
    // read as the same card at a glance.
    label:       'An author anniversary',
    accentClass: 'text-fuchsia-400/80',
  },
  personal_anniversary: {
    // Yellow for "your reading history" — warm/candlelit, distinct
    // from amber (slow_burn) and orange (anniversary) so the three
    // warm accents don't blur together.
    label:       'Looking back',
    accentClass: 'text-yellow-400/80',
  },
  connection: {
    label:       'A thread in your library',
    accentClass: 'text-teal-400/80',
  },
  reading_path: {
    label:       'A path through what you own',
    accentClass: 'text-emerald-400/80',
  },
};

function relativeMonths(days) {
  if (days == null) return '';
  if (days < 30)  return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  if (months >= 12) {
    const years = Math.round(days / 365);
    return years === 1 ? 'a year' : `${years} years`;
  }
  return months === 1 ? 'a month' : `${months} months`;
}

function relativeDays(days) {
  if (days == null) return '';
  if (days === 0)   return 'today';
  if (days === 1)   return 'yesterday';
  return `${days} days ago`;
}

function CardBody({ card }) {
  const { type, book } = card;
  const link = (
    <Link
      to={`/books/${book.id}`}
      className="underline decoration-neutral-700 hover:decoration-neutral-400 transition-colors text-parchment"
    >
      {book.title}
    </Link>
  );

  if (type === 'loved_resurface') {
    return (
      <p>
        You marked {link} as loved {relativeMonths(card.days_since_finished)} ago. Worth a re-read?
      </p>
    );
  }
  if (type === 'slow_burn') {
    const pages = book.current_page && book.page_count
      ? ` Page ${book.current_page} of ${book.page_count}.`
      : '';
    return (
      <p>
        You started {link} {card.days_since_started} days ago.{pages} Stuck or savouring?
      </p>
    );
  }
  if (type === 'recent_acquisition') {
    return (
      <p>
        {link} — bought {relativeDays(card.days_since_acquired)}, sitting unread. Slot it in?
      </p>
    );
  }
  if (type === 'forgotten_readlist') {
    // Show the readlist position only when it's small enough to read
    // as meaningful queue location. Past ~10 the number stops being
    // informative and just feels arbitrary ("at position 47" — okay,
    // but how deep is that?). Above the threshold, drop the number
    // and just signal that the book is buried.
    const pos = book.readlist_position;
    const posSuffix =
      pos != null && pos <= 10 ? ` at position ${pos}` :
      pos != null              ? ', deep in the queue' :
      '';
    return (
      <p>
        {link} — sitting on your readlist{posSuffix}, still unread. Move it up or take it off?
      </p>
    );
  }
  if (type === 'author_barely_opened') {
    const { author_name, book_count, finished_count } = card.meta || {};
    if (!author_name) return null;
    return (
      <p>
        {author_name} — {book_count} {book_count === 1 ? 'book' : 'books'} in your library,
        {' '}{finished_count} finished. Try {link}?
      </p>
    );
  }
  if (type === 'loved_author_followup') {
    const { author_name, loved_title } = card.meta || {};
    if (!author_name) return null;
    return (
      <p>
        You loved {loved_title ? <em>{loved_title}</em> : 'a book'} by {author_name}. Try {link}?
      </p>
    );
  }
  if (type === 'series_next_volume') {
    const { series, next_volume, prev_volume, prev_title, days_since_prev } = card.meta || {};
    if (!series || next_volume == null || prev_volume == null) return null;
    // days_since_prev is null when prev volume's date_finished is a partial
    // ('2019' / '2019-07'): julianday returns NULL on partials, so the
    // computation can't run. Drop the "{N} ago" segment in that case
    // instead of leaving a double-space gap before "ago."
    const elapsed = days_since_prev != null ? <> {relativeMonths(days_since_prev)} ago.</> : '.';
    return (
      <p>
        You finished Vol {prev_volume} of <em>{series}</em>
        {prev_title ? <> (<em>{prev_title}</em>)</> : null}
        {elapsed} Vol {next_volume}: {link} — read on?
      </p>
    );
  }
  if (type === 'personal_anniversary') {
    const { event, years_ago } = card.meta || {};
    if (!event || !years_ago) return null;
    const yearLabel = years_ago === 1 ? 'one year' : `${years_ago} years`;
    const verb = event === 'finished' ? 'finished' : 'acquired';
    return (
      <p>
        You {verb} {link} {yearLabel} ago today.
      </p>
    );
  }
  if (type === 'anniversary') {
    const { years_ago, year_published } = card.meta || {};
    if (!years_ago || !year_published) return null;
    return (
      <p>
        {link} — {years_ago} years old this year. Published {year_published}.
      </p>
    );
  }
  if (type === 'author_anniversary') {
    const { author_name, author_gender, event, event_year, years_ago, book_count } = card.meta || {};
    if (!author_name || !event || !years_ago) return null;
    // event_year can be negative for BCE authors; flag it as "BCE"
    // in the display so the year reads correctly.
    const yearLabel = event_year < 0 ? `${-event_year} BCE` : String(event_year);
    const verb = event === 'death' ? 'died' : 'was born';
    // Pronoun for "books by ___": gender-driven where the author has
    // one recorded, singular-they fallback when gender is null or
    // 'other'. Authors table vocab is male / female / other / NULL.
    const pronoun = author_gender === 'male' ? 'him'
                  : author_gender === 'female' ? 'her'
                  : 'them';
    const countStr = book_count > 0
      ? ` You have ${book_count} book${book_count === 1 ? '' : 's'} by ${pronoun}.`
      : '';
    return (
      <p>
        {author_name} {verb} {years_ago} years ago, in {yearLabel}.{countStr} Try {link}?
      </p>
    );
  }
  return null;
}

// Connection cards carry a longer markdown body with [#NNN](spine-book:NNN)
// references. Reuses the BookDetail page's proseMarkdown link override
// so [#123](spine-book:123) renders as a live BookRef (resolves the
// current title from the books table) rather than as a raw link.
//
// Exported so PastConnections can reuse the same rendering for the
// archive list below today's card on /today.
export function ConnectionBody({ body }) {
  const md = useMemo(() => ({
    urlTransform: (url) => url.startsWith('spine-book:') ? url : defaultUrlTransform(url),
    components: {
      a: ({ href, children, node: _node, ...props }) => {
        if (href?.startsWith('spine-book:')) {
          const refId = Number(href.slice(11));
          if (Number.isFinite(refId)) return <BookRef id={refId} />;
        }
        return <a href={href} {...props}>{children}</a>;
      },
      // Tighten react-markdown's default block spacing so the connection
      // reads as a short essay paragraph, not a stretched-out doc.
      p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
      em: ({ children }) => <em className="italic">{children}</em>,
      strong: ({ children }) => <strong className="text-parchment">{children}</strong>,
    },
  }), []);
  return <ReactMarkdown {...md}>{body}</ReactMarkdown>;
}

// Exported so PastConnections can re-grade archived rows without
// duplicating the optimistic-update + rollback dance.
export function FeedbackBar({ queueId, current }) {
  const [value, setValue] = useState(current || null);
  const [saving, setSaving] = useState(false);

  // Sync internal state when the `current` prop changes — e.g., a
  // PastConnections re-render after a refetch surfaces a server-side
  // grade we haven't seen locally yet, or a Connection card mounts
  // with a pre-existing feedback value. Without this, the locally-
  // cached value from the first mount would shadow any later prop
  // updates from above.
  useEffect(() => { setValue(current || null); }, [current, queueId]);

  async function grade(next) {
    // Toggle off if same value clicked again — useful for mis-clicks.
    // Capture the prior value BEFORE the optimistic update so the
    // rollback restores the pre-click state rather than the optimistic
    // target (the bug pre-1.223.1).
    const prior = value;
    const target = prior === next ? null : next;
    setSaving(true);
    setValue(target);  // optimistic
    try {
      await api.postTodayFeedback(queueId, target);
    } catch {
      setValue(prior); // rollback to actual pre-click value
    } finally {
      setSaving(false);
    }
  }

  const btn = (key, label, accentClass) => (
    <button
      key={key}
      type="button"
      onClick={() => grade(key)}
      disabled={saving}
      aria-pressed={value === key}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        value === key
          ? `${accentClass} border-current`
          : 'border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-5 pt-4 border-t border-neutral-800/60 flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-neutral-600 mr-1">How was it?</span>
      {btn('signal',   'Signal',   'text-emerald-400')}
      {btn('knew',     'Knew it',  'text-neutral-300')}
      {btn('reaching', 'Reaching', 'text-amber-400')}
    </div>
  );
}

// Optional `date` and `peek` props power the /today day-navigation
// surface (1.223+). Default (no date) fetches the current day and
// goes through pickTodayCard's compute path. Setting `date` to a
// past YYYY-MM-DD with `peek` lets the page render historical cards
// without retroactively filling in days the user never visited.
export default function TodayCard({ date, peek = false, onCardLoaded }) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = {};
    if (date) params.date = date;
    if (peek) params.peek = 'true';
    api.getTodayCard(params)
      .then(d => {
        if (cancelled) return;
        const next = d?.card || null;
        setCard(next);
        setLoading(false);
        if (onCardLoaded) onCardLoaded(next);
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
    // onCardLoaded comes from useState's setter in the parent (stable
    // reference) so including it in deps is safe and the lint can
    // be satisfied without ceremony.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, peek]);

  // Only blank during the very first load — once we've shown a card,
  // keep it on screen during subsequent refetches (date navigation,
  // etc.) so arrowing between days doesn't flash an empty surface
  // mid-transition. The new card replaces the old one the moment
  // the fetch resolves. The skeleton shell holds vertical space
  // during that first load so the carousel slivers (items-stretch)
  // have something to size against — a bare null collapsed the row
  // to ~0px for a few frames — and adds light pulse-shapes so a
  // slightly-longer fetch reads as "loading" rather than "empty."
  if (loading && !card) {
    return <TodayCardSkeleton />;
  }

  if (error) {
    return (
      <div className="p-6 rounded-lg border border-neutral-800/60 text-sm text-neutral-500">
        Couldn't load today's card.
      </div>
    );
  }

  if (!card) {
    // Two empty-state shapes. On today: no eligible cohort — fresh
    // library or quiet rotation day. On a past peek view: nothing
    // was served on that date (either we never picked one or the
    // history was pruned).
    const message = peek
      ? "No card was served on this day."
      : "Nothing surfaced for today. Come back after you've loved or started a few books.";
    return (
      <div className="p-6 rounded-lg border border-neutral-800/60 text-sm text-neutral-500">
        {message}
      </div>
    );
  }

  const meta = TYPE_LABEL[card.type];
  if (!meta) return null;

  // Queue-driven card types (Connection / Reading Path) render the
  // queue payload (title + markdown body) and surface the post-hoc
  // Signal / Knew / Reaching feedback bar. Book-cohort cards use the
  // one-sentence CardBody layout below. Both queue types share the
  // same markup; only the meta label / accent differs.
  if (card.type === 'connection' || card.type === 'reading_path') {
    return (
      <div className="p-6 rounded-lg bg-neutral-900/60 border border-neutral-800/60">
        <div className={`text-[10px] font-semibold uppercase tracking-wider mb-3 ${meta.accentClass}`}>
          {meta.label}
        </div>
        <h2 className="font-slab text-xl text-parchment mb-3">{card.title}</h2>
        <div className="text-sm text-neutral-300 leading-relaxed">
          <ConnectionBody body={card.body} />
        </div>
        <FeedbackBar queueId={card.queue_id} current={card.feedback} />
      </div>
    );
  }

  return (
    <div className="p-6 rounded-lg bg-neutral-900/60 border border-neutral-800/60">
      <div className={`text-[10px] font-semibold uppercase tracking-wider mb-3 ${meta.accentClass}`}>
        {meta.label}
      </div>
      <div className="flex gap-4 items-start">
        <CardThumb book={card.book} />
        <div className="text-base text-neutral-300 leading-relaxed flex-1 min-w-0">
          <CardBody card={card} />
        </div>
      </div>
      {/* key={book.id} forces a remount on card swap (carousel
          navigation, mid-day rotation) so the action bar's local
          onReadlist + snoozedUntil state doesn't leak across books.
          useState initializers only fire on first mount, so without
          the key the bar would keep showing the previous book's
          readlist/snooze state — the FeedbackBar handles this via
          a `[current, queueId]` useEffect; the bar takes the simpler
          remount route since it has no focus / scroll state worth
          preserving. */}
      <CardActionBar key={card.book.id} card={card} />
    </div>
  );
}

// Inline action bar on book-cohort cards (1.231+). Two universal
// verbs by default — readlist toggle + snooze. Type-specific
// suppressions: slow_burn and personal_anniversary skip the readlist
// button (a reading-status book or a reflective re-acquaintance card
// doesn't gain anything from the readlist nudge); forgotten_readlist
// flips the readlist button to "Remove from readlist" since the book
// is already on the list and the cohort is precisely "buried in the
// queue." Both buttons go optimistic-update + rollback on error.
const READLIST_OMITTED_TYPES = new Set([
  'slow_burn',
  'personal_anniversary',
]);

function CardActionBar({ card }) {
  const book = card?.book;
  if (!book) return null;
  const showReadlist = !READLIST_OMITTED_TYPES.has(card.type);
  const removeMode   = card.type === 'forgotten_readlist';
  const [onReadlist, setOnReadlist] = useState(!!book.on_readlist);
  const [snoozedUntil, setSnoozedUntil] = useState(null);
  const [savingReadlist, setSavingReadlist] = useState(false);
  const [savingSnooze, setSavingSnooze] = useState(false);

  async function toggleReadlist() {
    const prior = onReadlist;
    const target = removeMode ? false : true;
    if (prior === target) return;  // already in target state, no work
    setSavingReadlist(true);
    setOnReadlist(target);  // optimistic
    try {
      await api.patchBook(book.id, { on_readlist: target ? 1 : 0 });
    } catch {
      setOnReadlist(prior);  // rollback
    } finally {
      setSavingReadlist(false);
    }
  }

  async function snooze() {
    setSavingSnooze(true);
    const prior = snoozedUntil;
    setSnoozedUntil('pending');  // optimistic placeholder
    try {
      const res = await api.postTodaySnooze(book.id, 7);
      setSnoozedUntil(res?.snoozed_until || 'until next week');
    } catch {
      setSnoozedUntil(prior);
    } finally {
      setSavingSnooze(false);
    }
  }

  // Readlist label flips on the type-specific axis:
  //   - forgotten_readlist: "Remove from readlist" → confirmation "Removed"
  //   - other book-cohort:  "Add to readlist"      → confirmation "On readlist"
  const readlistLabel =
    removeMode
      ? (onReadlist ? 'Remove from readlist' : 'Removed')
      : (onReadlist ? 'On readlist'          : 'Add to readlist');
  const readlistDone =
    removeMode ? !onReadlist : onReadlist;

  // Hide the bar entirely when there's nothing to render — keeps the
  // card flush with no empty whitespace footer.
  if (!showReadlist) {
    // Snooze-only path. If already snoozed (this session), show the
    // confirmation; else show the snooze button.
    return (
      <div className="mt-5 pt-4 border-t border-neutral-800/60 flex items-center gap-2">
        <SnoozeButton
          snoozedUntil={snoozedUntil}
          saving={savingSnooze}
          onClick={snooze}
        />
      </div>
    );
  }
  return (
    <div className="mt-5 pt-4 border-t border-neutral-800/60 flex items-center gap-2 flex-wrap">
      <ActionButton
        onClick={toggleReadlist}
        disabled={savingReadlist || readlistDone}
        active={readlistDone}
      >
        {readlistLabel}
      </ActionButton>
      <SnoozeButton
        snoozedUntil={snoozedUntil}
        saving={savingSnooze}
        onClick={snooze}
      />
    </div>
  );
}

function ActionButton({ onClick, disabled, active, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'text-emerald-400 border-emerald-400/60'
          : 'border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700'
      } disabled:opacity-60 disabled:cursor-default`}
    >
      {children}
    </button>
  );
}

function SnoozeButton({ snoozedUntil, saving, onClick }) {
  if (snoozedUntil) {
    return (
      <span className="text-xs px-2.5 py-1 rounded-full border border-neutral-800 text-neutral-500">
        Snoozed
      </span>
    );
  }
  return (
    <ActionButton onClick={onClick} disabled={saving} active={false}>
      Snooze 7 days
    </ActionButton>
  );
}

// Cover thumbnail for book-cohort cards. Lives left of the body so the
// card reads as a shelf item rather than a paragraph. Wrapped in a
// Link to /books/{id} so clicking the cover navigates the same way
// the in-body title link does. Falls back to initialsFor(book.title)
// when no cover is on file.
function CardThumb({ book }) {
  if (!book) return null;
  return (
    <Link
      to={`/books/${book.id}`}
      aria-label={book.title}
      className="flex-none w-16 aspect-[2/3] rounded overflow-hidden bg-neutral-800/60 flex items-center justify-center group"
    >
      {book.cover_path
        ? (
          <img
            src={book.cover_path}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
          />
        )
        : (
          <span className="text-neutral-500 text-xs font-medium">
            {initialsFor(book.title)}
          </span>
        )}
    </Link>
  );
}
