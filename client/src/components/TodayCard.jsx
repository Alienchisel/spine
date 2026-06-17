import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// v0 of the daily "Today" card. Three deterministic card types
// (loved_resurface / slow_burn / recent_acquisition) computed from
// local SQL on the server — no AI yet. The card sits at the top of
// Library, soaks up exactly one row of vertical space, and dismisses
// for the rest of the calendar day. Tomorrow a new card slides in
// (or the same type with a different book if the cohort is small).
//
// Identity colours map each card type to one of Spine's nav-hue
// palette: rose for loved, amber for the long-running read,
// sky for the freshly-bought book. The labels themselves are
// uppercase / tracking-wide / text-[10px] to match the FilterPanel
// label rhythm — same visual register as the "FORMAT" / "RATING" /
// "TAGS" column on the left of the filter rail.

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
};

// Render a calendar-day diff into the natural-English phrasing the
// card body uses. "months" rounds at 30 days/month; "years" at 365
// days/year. Returns the phrase without a trailing "ago" — the body
// supplies that so the grammar is consistent across types.
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
  if (days == null)  return '';
  if (days === 0)    return 'today';
  if (days === 1)    return 'yesterday';
  return `${days} days ago`;
}

const TODAY = () => new Date().toLocaleDateString('en-CA');  // YYYY-MM-DD
const DISMISS_KEY = 'today-card-dismissed';

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
  return null;
}

export default function TodayCard() {
  const [card, setCard] = useState(null);
  const [dismissed, setDismissed] = useState(true); // default hidden until we know

  useEffect(() => {
    let cancelled = false;
    // Per-day dismissal: localStorage stores the YYYY-MM-DD the user
    // last hit ✕. If it matches today, stay hidden; otherwise fetch.
    const dismissedDate = localStorage.getItem(DISMISS_KEY);
    if (dismissedDate === TODAY()) {
      setDismissed(true);
      return () => { cancelled = true; };
    }
    setDismissed(false);
    api.getTodayCard()
      .then(d => { if (!cancelled) setCard(d?.card || null); })
      .catch(() => { if (!cancelled) setCard(null); });
    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, TODAY());
    setDismissed(true);
  }

  if (dismissed || !card) return null;
  const meta = TYPE_LABEL[card.type];
  if (!meta) return null;

  return (
    <div className="mb-6 flex items-start gap-4 p-4 rounded-lg bg-neutral-900/60 border border-neutral-800/60">
      <div className="flex-1 min-w-0">
        <div className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${meta.accentClass}`}>
          {meta.label}
        </div>
        <div className="text-sm text-neutral-300 leading-relaxed">
          <CardBody card={card} />
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss today's card"
        title="Dismiss for today"
        className="text-neutral-600 hover:text-neutral-300 transition-colors text-sm leading-none mt-0.5"
      >
        ✕
      </button>
    </div>
  );
}
