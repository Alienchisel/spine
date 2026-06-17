import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import TodayCard from '../components/TodayCard.jsx';
import PastConnections from '../components/PastConnections.jsx';
import PastReadingPaths from '../components/PastReadingPaths.jsx';
import { fmtShortDate } from '../utils.js';

// Dedicated route for the daily card. Lives at /today, nav-linked
// in teal. Reflective surface — librarian's nudge of the day —
// separated from Library's transactional shape (browse / add / edit).
//
// 1.223 adds day navigation. The route reads an optional ?date=YYYY-MM-DD
// search param; default (no param) renders today's card alongside the
// Past Connections and Past Reading Paths archives. A past-date view
// shows just that day's persisted card with arrow navigation (no
// archives — those belong to today's reflection). Can't navigate past
// today; the back direction has no hard floor since persisted history
// runs back to whenever the feature shipped.
//
// localStorage 'today-visited' breadcrumb is only written when viewing
// the CURRENT date so navigating to past days doesn't suppress the
// Nav's "new today" dot.

export const TODAY_VISITED_KEY = 'today-visited';

function todayStr() {
  return new Date().toLocaleDateString('en-CA');  // local YYYY-MM-DD
}

// Calendar-day arithmetic via setDate — no JS ms math, DST-safe per
// the project's no-ms-arithmetic-for-days rule.
function shiftDay(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA');
}

function isValidDateParam(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function DayNav({ viewedDate, currentDate }) {
  const prev = shiftDay(viewedDate, -1);
  const next = shiftDay(viewedDate, +1);
  const canGoNext = next <= currentDate;

  // Build link targets. Today (the current calendar date) gets the
  // bare /today path so URL stays clean for the default surface.
  const prevTo = `/today?date=${prev}`;
  const nextTo = next === currentDate ? '/today' : `/today?date=${next}`;

  return (
    <div className="flex items-center justify-between mb-6 text-sm">
      <Link
        to={prevTo}
        className="text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        ← {fmtShortDate(prev)}
      </Link>
      {viewedDate !== currentDate ? (
        <Link
          to="/today"
          className="text-teal-400/80 hover:text-teal-300 transition-colors"
        >
          Today
        </Link>
      ) : (
        <span />
      )}
      {canGoNext ? (
        <Link
          to={nextTo}
          className="text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          {next === currentDate ? 'Today' : fmtShortDate(next)} →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

export default function Today() {
  const [params] = useSearchParams();
  const [todayCard, setTodayCard] = useState(null);

  const currentDate = todayStr();
  const requested = params.get('date');
  // A bad ?date= param silently coerces to today rather than 404 — the
  // surface is forgiving for hand-typed URLs.
  const viewedDate = isValidDateParam(requested) ? requested : currentDate;
  const onToday    = viewedDate === currentDate;

  useEffect(() => {
    // Only mark visited on the current-day view. Visiting past days
    // shouldn't dismiss today's nav dot — the dot's whole job is to
    // signal that TODAY hasn't been opened yet.
    if (onToday) {
      try { localStorage.setItem(TODAY_VISITED_KEY, todayStr()); } catch {}
    }
  }, [onToday]);

  // Both queue-driven archives need to know whether today's surface
  // is one of theirs, so they can hide that row from the past list.
  // Only meaningful on the current-day view since archives don't show
  // on past-date views at all.
  const todayConnectionId  = todayCard?.type === 'connection'   ? todayCard.queue_id : null;
  const todayReadingPathId = todayCard?.type === 'reading_path' ? todayCard.queue_id : null;

  return (
    <div>
      <IncomingBackLink />
      <div className="mb-8">
        <h1 className="font-slab text-3xl text-parchment mb-1">
          {onToday ? 'Today' : fmtShortDate(viewedDate)}
        </h1>
        <p className="text-sm text-neutral-500">
          {onToday ? 'A daily nudge from your library.' : 'A past card from your library.'}
        </p>
      </div>
      <div className="max-w-2xl">
        <DayNav viewedDate={viewedDate} currentDate={currentDate} />
        <TodayCard
          date={onToday ? undefined : viewedDate}
          peek={!onToday}
          onCardLoaded={setTodayCard}
        />
        {onToday && (
          <>
            <PastConnections  excludeQueueId={todayConnectionId} />
            <PastReadingPaths excludeQueueId={todayReadingPathId} />
          </>
        )}
      </div>
    </div>
  );
}
