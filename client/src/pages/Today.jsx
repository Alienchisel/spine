import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import TodayCard from '../components/TodayCard.jsx';
import TodayCarousel from '../components/TodayCarousel.jsx';
import TodayQueueBanner from '../components/TodayQueueBanner.jsx';
import PastConnections from '../components/PastConnections.jsx';
import PastReadingPaths from '../components/PastReadingPaths.jsx';
import { fmtShortDate } from '../utils.js';

// Dedicated route for the daily card. Lives at /today, nav-linked
// in teal. Reflective surface — librarian's nudge of the day —
// separated from Library's transactional shape (browse / add / edit).
//
// 1.226 swaps the arrow-button DayNav for a horizontal carousel
// (TodayCarousel) — past day on the left, today centre, face-down
// "tomorrow" on the right. Past lookback caps at 14 days; deeper
// history lives in the Past Connections / Past Reading Paths
// archives in the sidebar. The route still reads an optional
// ?date=YYYY-MM-DD search param; default (no param) renders today's
// card. A past-date view shows that day's persisted card centred,
// with the archive sidebar still mounted.
//
// 'today-visited' breadcrumb is only written when viewing the CURRENT
// date so navigating to past days doesn't suppress the Nav's "new
// today" dot. Stored on the server (settings table) so the visited
// state syncs across devices — phone visit clears the dot on PC and
// vice versa. localStorage is still updated as a fast same-device cache.

export const TODAY_VISITED_KEY = 'today-visited';

function todayStr() {
  return new Date().toLocaleDateString('en-CA');  // local YYYY-MM-DD
}

function isValidDateParam(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
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
      const value = todayStr();
      try { localStorage.setItem(TODAY_VISITED_KEY, value); } catch {}
      fetch(`/api/settings/${TODAY_VISITED_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }).catch(() => {});
    }
  }, [onToday]);

  // Both queue-driven archives need to know whether today's surface
  // is one of theirs, so they can hide that row from the past list.
  // The exclude only applies on the current-day view — on a past-date
  // view, the centred card IS the archive entry the user wants to see
  // flanked by the rest of the history, so hiding it would defeat the
  // point.
  const todayConnectionId  = onToday && todayCard?.type === 'connection'   ? todayCard.queue_id : null;
  const todayReadingPathId = onToday && todayCard?.type === 'reading_path' ? todayCard.queue_id : null;

  return (
    <div>
      <IncomingBackLink />
      <div className="mb-8">
        <h1 className="font-slab text-3xl text-parchment mb-1">
          {onToday ? 'Today' : fmtShortDate(viewedDate)}
        </h1>
        <p className="text-sm text-neutral-500">
          {onToday ? 'A daily nudge from your library.' : (
            <>
              A past card from your library.{' '}
              <Link to="/today" className="text-teal-400/80 hover:text-teal-300 transition-colors">
                Back to today
              </Link>
            </>
          )}
        </p>
      </div>
      {/* xl:flex peels the past-lists archive into a sidebar on wide
          screens (xl chosen over lg so the sidebar always has enough
          width to render PastQueueList's full-card layout — at lg the
          ~256 px column was too cramped for the ConnectionBody prose).
          The today card column keeps its max-w-2xl tuning; the sidebar
          xl:flex-1 takes whatever's left of the max-w-7xl page. The
          sidebar stays mounted on past-date views too — it's "archive
          from today's perspective", independent of which day's card is
          centred, so it behaves like persistent chrome rather than
          flashing in and out as the user scrubs through days. */}
      <div className="xl:flex xl:gap-8 xl:items-start">
        <div className="max-w-2xl">
          {onToday && <TodayQueueBanner />}
          <TodayCarousel viewedDate={viewedDate} currentDate={currentDate}>
            <TodayCard
              date={onToday ? undefined : viewedDate}
              peek={!onToday}
              onCardLoaded={setTodayCard}
            />
          </TodayCarousel>
        </div>
        {/* First PastQueueList's mt-12 is overridden on xl+ so the
           sidebar's first heading aligns with the top of the card
           column (mobile still wants the gap because the sidebar
           stacks below the carousel there). xl:max-w-lg caps the
           archive rail so the card column reads as the page's
           primary surface — the sidebar is supporting context, not
           a co-equal pane. */}
        <aside className="mt-12 xl:mt-0 xl:flex-1 xl:max-w-lg xl:[&>div:first-child]:mt-0 xl:min-w-0">
          <PastConnections  excludeQueueId={todayConnectionId} />
          <PastReadingPaths excludeQueueId={todayReadingPathId} />
        </aside>
      </div>
    </div>
  );
}
