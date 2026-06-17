import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

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
  return null;
}

export default function TodayCard() {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getTodayCard()
      .then(d => { if (!cancelled) { setCard(d?.card || null); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;

  if (error) {
    return (
      <div className="p-6 rounded-lg border border-neutral-800/60 text-sm text-neutral-500">
        Couldn't load today's card.
      </div>
    );
  }

  if (!card) {
    // No cohort eligible — fresh library, or just nothing loved /
    // long-running / recently bought. Show a quiet placeholder rather
    // than nothing, so the page doesn't read as "broken."
    return (
      <div className="p-6 rounded-lg border border-neutral-800/60 text-sm text-neutral-500">
        Nothing surfaced for today. Come back after you've loved or started a few books.
      </div>
    );
  }

  const meta = TYPE_LABEL[card.type];
  if (!meta) return null;

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
