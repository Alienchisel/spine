import { useState } from 'react';
import { formatDate } from '../../utils.js';

const COLLAPSED_LIMIT = 10;

export default function ReadingLog({ log, isAudiobook, status, pageCount }) {
  const [expanded, setExpanded] = useState(false);
  if (!log.length) return null;

  // Time-only entries (pages_read=0, minutes_read>0) come from the Kindle/
  // Audible backfill paths where we have session duration but no print pages.
  // Each book-level reading_log row is unique on (book_id, date), so a row
  // is a day-of-activity, not a "session" in the timeline sense.
  const activeDays = log.filter(e => e.pages_read > 0 || e.minutes_read > 0).length;
  const since = formatDate(log[log.length - 1].date);
  const pagesSum   = log.reduce((s, e) => s + (e.pages_read   || 0), 0);
  const minutesSum = log.reduce((s, e) => s + (e.minutes_read || 0), 0);
  const formatTime = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;
  // Cascading total. Audiobooks naturally use time. Non-audiobooks prefer
  // pages, with three fallbacks: a finished ebook with a known page_count
  // shows the book's length (the natural total even when per-day pages
  // weren't tracked); otherwise positive minutes are shown for in-progress
  // ebooks backfilled from session data; otherwise the total is dropped.
  const total = isAudiobook
    ? formatTime(minutesSum)
    : pagesSum > 0
      ? `${pagesSum} pages`
      : (status === 'finished' && pageCount > 0)
        ? `${pageCount} pages`
        : minutesSum > 0
          ? formatTime(minutesSum)
          : null;

  const overLimit = log.length > COLLAPSED_LIMIT;
  const visible   = expanded || !overLimit ? log : log.slice(0, COLLAPSED_LIMIT);

  return (
    <div className="border-t border-neutral-800 pt-5">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Reading log</p>
      <p className="text-xs text-neutral-600 mb-3">{activeDays} days{total ? ` · ${total}` : ''} since {since}</p>
      <div className="space-y-1">
        {visible.map((entry) => (
          <div key={entry.date} className="flex justify-between text-xs text-neutral-500">
            <span>{formatDate(entry.date)}</span>
            <span className="text-neutral-600">
              {isAudiobook
                ? entry.minutes_read ? `${Math.floor(entry.minutes_read / 60)}h ${entry.minutes_read % 60}m` : null
                : entry.pages_read ? `${entry.pages_read} p.` : null}
            </span>
          </div>
        ))}
      </div>
      {overLimit && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors mt-3"
        >
          {expanded ? 'Show less' : `Show all (${log.length})`}
        </button>
      )}
    </div>
  );
}
