import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { api } from '../api.js';
import BookRef from './bookDetail/BookRef.jsx';

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
    label:       'More by an author you loved',
    accentClass: 'text-rose-400/80',
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
    const pos = book.readlist_position;
    return (
      <p>
        {link} — sitting on your readlist
        {pos != null ? ` at position ${pos}` : ''}, still unread. Move it up or take it off?
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

  async function grade(next) {
    // Toggle off if same value clicked again — useful for mis-clicks.
    const target = value === next ? null : next;
    setSaving(true);
    setValue(target);  // optimistic
    try {
      await api.postTodayFeedback(queueId, target);
    } catch {
      setValue(value); // rollback
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

  if (loading) return null;

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
      <div className="text-base text-neutral-300 leading-relaxed">
        <CardBody card={card} />
      </div>
    </div>
  );
}
