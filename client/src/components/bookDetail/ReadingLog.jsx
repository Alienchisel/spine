import { formatDate } from './dates.js';

export default function ReadingLog({ log, isAudiobook }) {
  if (!log.length) return null;

  const sessions = log.filter(e => isAudiobook ? e.minutes_read > 0 : e.pages_read > 0).length;
  const since = formatDate(log[log.length - 1].date);
  const total = isAudiobook
    ? (() => { const m = log.reduce((s, e) => s + (e.minutes_read || 0), 0); return `${Math.floor(m / 60)}h ${m % 60}m`; })()
    : `${log.reduce((s, e) => s + (e.pages_read || 0), 0)} pages`;

  return (
    <div className="border-t border-neutral-800 pt-5">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Reading log</p>
      <p className="text-xs text-neutral-600 mb-3">{sessions} sessions · {total} since {since}</p>
      <div className="space-y-1">
        {log.map((entry) => (
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
    </div>
  );
}
