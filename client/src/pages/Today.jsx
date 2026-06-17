import { useEffect, useState } from 'react';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import TodayCard from '../components/TodayCard.jsx';
import PastConnections from '../components/PastConnections.jsx';

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
  const [todayQueueId, setTodayQueueId] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(TODAY_VISITED_KEY, todayStr()); } catch {}
  }, []);

  return (
    <div>
      <IncomingBackLink />
      <div className="mb-8">
        <h1 className="font-slab text-3xl text-parchment mb-1">Today</h1>
        <p className="text-sm text-neutral-500">A daily nudge from your library.</p>
      </div>
      <div className="max-w-2xl">
        <TodayCard onCardLoaded={card => {
          // Today's card is a connection? Capture its queue id so
          // PastConnections can exclude it (avoid double-rendering).
          if (card?.type === 'connection') setTodayQueueId(card.queue_id);
          else setTodayQueueId(null);
        }} />
        <PastConnections excludeQueueId={todayQueueId} />
      </div>
    </div>
  );
}
