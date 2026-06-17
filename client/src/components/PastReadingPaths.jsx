import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ConnectionBody, FeedbackBar } from './TodayCard.jsx';
import { fmtShortDate } from '../utils.js';

// Reverse-chronological list of served Reading Path cards below
// today's card on /today. Parallel to PastConnections — same shape,
// different card_type. Both queue-driven types share the markdown
// renderer + feedback bar from TodayCard, so re-reading and
// re-grading feel continuous across both archives.

export default function PastReadingPaths({ excludeQueueId }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getPastReadingPaths()
      .then(d => { if (!cancelled) setItems(d?.readingPaths || []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  if (items == null) return null;
  const filtered = excludeQueueId
    ? items.filter(c => c.queue_id !== excludeQueueId)
    : items;
  if (!filtered.length) return null;

  return (
    <div className="mt-12">
      <h2 className="font-slab text-xl text-parchment mb-1">Past paths</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Reading sequences from previous days. Re-read, re-grade.
      </p>
      <div className="space-y-4">
        {filtered.map(c => (
          <article
            key={c.queue_id}
            className="p-6 rounded-lg bg-neutral-900/40 border border-neutral-800/60"
          >
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h3 className="font-slab text-lg text-parchment leading-tight">{c.title}</h3>
              {c.served_date && (
                <span className="text-[10px] uppercase tracking-wider text-neutral-600 whitespace-nowrap">
                  {fmtShortDate(c.served_date)}
                </span>
              )}
            </div>
            <div className="text-sm text-neutral-300 leading-relaxed">
              <ConnectionBody body={c.body} />
            </div>
            <FeedbackBar queueId={c.queue_id} current={c.feedback} />
          </article>
        ))}
      </div>
    </div>
  );
}
