import IncomingBackLink from '../components/IncomingBackLink.jsx';
import TodayCard from '../components/TodayCard.jsx';

// Dedicated route for the daily card. Lives at /today, nav-linked
// in teal. Reflective surface — librarian's nudge of the day —
// separated from Library's transactional shape (browse / add / edit).
// Single card at v0; the page will accumulate card-history scroll-back
// and saved-cards browsing as the feature matures and the AI-generated
// card types (Connection / Reading Path / Author Spotlight) come
// online.

export default function Today() {
  return (
    <div>
      <IncomingBackLink />
      <div className="mb-8">
        <h1 className="font-slab text-3xl text-parchment mb-1">Today</h1>
        <p className="text-sm text-neutral-500">A daily nudge from your library.</p>
      </div>
      <div className="max-w-2xl">
        <TodayCard />
      </div>
    </div>
  );
}
