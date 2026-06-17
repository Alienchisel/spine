import { useEffect, useState } from 'react';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import TodayCard from '../components/TodayCard.jsx';
import PastConnections from '../components/PastConnections.jsx';
import PastReadingPaths from '../components/PastReadingPaths.jsx';

// Dedicated route for the daily card. Lives at /today, nav-linked
// in teal. Reflective surface — librarian's nudge of the day —
// separated from Library's transactional shape (browse / add / edit).
// The page also drops a YYYY-MM-DD breadcrumb in localStorage so the
// Nav can suppress its "new today" indicator dot once the user has
// landed here on this calendar day.
//
// Below the current card sits a reverse-chronological list of past
// served Connection cards (PastConnections) — the AI-generated work
// is too curated to vanish after one day. Today's connection (if
// any) is excluded from that list via TodayCard's onCardLoaded
// callback so the same card doesn't render twice.

export const TODAY_VISITED_KEY = 'today-visited';

function todayStr() {
  return new Date().toLocaleDateString('en-CA');  // local YYYY-MM-DD
}

export default function Today() {
  const [todayCard, setTodayCard] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(TODAY_VISITED_KEY, todayStr()); } catch {}
  }, []);

  // Both queue-driven archives need to know whether today's surface
  // is one of theirs, so they can hide that row from the past list.
  // Splitting the exclusion by card_type means a connection day
  // doesn't accidentally hide a reading_path row (and vice versa).
  const todayConnectionId  = todayCard?.type === 'connection'   ? todayCard.queue_id : null;
  const todayReadingPathId = todayCard?.type === 'reading_path' ? todayCard.queue_id : null;

  return (
    <div>
      <IncomingBackLink />
      <div className="mb-8">
        <h1 className="font-slab text-3xl text-parchment mb-1">Today</h1>
        <p className="text-sm text-neutral-500">A daily nudge from your library.</p>
      </div>
      <div className="max-w-2xl">
        <TodayCard onCardLoaded={setTodayCard} />
        <PastConnections  excludeQueueId={todayConnectionId} />
        <PastReadingPaths excludeQueueId={todayReadingPathId} />
      </div>
    </div>
  );
}
