import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

// Low-queue indicator for /today (1.233+). Fires only when either
// queue type drops below LOW_THRESHOLD unserved rows — silent the
// rest of the time. Matches how the Nav "new today" dot works: only
// surfaces signal, never noise. Cached under the 'today' bridge key;
// the queue changes only when the user (or a curation script) inserts
// new rows or the daily seed serves an unserved one, so mutation-
// driven invalidation is enough.

const LOW_THRESHOLD = 3;

const TYPE_LABEL = {
  connection:   'Connection',
  reading_path: 'Reading path',
};

export default function TodayQueueBanner() {
  const { data: depth } = useQuery({
    queryKey: ['today', 'queue-depth'],
    queryFn: async () => (await api.getTodayQueueDepth())?.depth || null,
  });

  if (!depth) return null;
  const low = Object.entries(depth)
    .filter(([, n]) => n < LOW_THRESHOLD)
    .map(([type, n]) => ({ type, n }));
  if (!low.length) return null;

  return (
    <div className="mb-4 px-3 py-2 rounded-md border border-amber-700/40 bg-amber-950/30 text-xs text-amber-200/80 flex items-center gap-2 flex-wrap">
      <span className="font-medium uppercase tracking-wider text-amber-300/80">
        Queue low
      </span>
      <span className="text-amber-200/70">
        {low.map(({ type, n }, i) => (
          <span key={type}>
            {i > 0 && ' · '}
            {TYPE_LABEL[type] || type} — {n} left
          </span>
        ))}
      </span>
    </div>
  );
}
