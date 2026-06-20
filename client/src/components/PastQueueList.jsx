import { useState } from 'react';
import { ConnectionBody, FeedbackBar } from './TodayCard.jsx';
import { fmtShortDate } from '../utils.js';

// Shared list shell for the two queue-driven archives below /today —
// Past Connections and Past Reading Paths. Both render reverse-
// chronological cards with the same ConnectionBody + FeedbackBar
// treatment as the current day's card, so re-reading and re-grading
// feel continuous.
//
// Collapsing behaviour (1.227): once the list grows past
// AUTO_EXPAND_THRESHOLD rows, only the most recent DEFAULT_VISIBLE
// stay expanded by default — older rows hide behind a "Show all (N)"
// toggle. The freshest context (most likely to be re-graded) stays
// within scrolling reach; the rest is one click away. Under the
// threshold the toggle doesn't appear at all — no "Show all (3)"
// noise for shallow archives.

const DEFAULT_VISIBLE       = 5;
const AUTO_EXPAND_THRESHOLD = 7;

export default function PastQueueList({ items, title, subtitle }) {
  const [expanded, setExpanded] = useState(false);

  if (!items?.length) return null;

  const showToggle = items.length > AUTO_EXPAND_THRESHOLD;
  const visible = (showToggle && !expanded)
    ? items.slice(0, DEFAULT_VISIBLE)
    : items;

  return (
    <div className="mt-12">
      <h2 className="font-slab text-xl text-parchment mb-1">{title}</h2>
      <p className="text-sm text-neutral-500 mb-4">{subtitle}</p>
      <div className="space-y-4">
        {visible.map(c => (
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
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-4 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          {expanded
            ? `Show recent ${DEFAULT_VISIBLE}`
            : `Show all (${items.length})`}
        </button>
      )}
    </div>
  );
}
