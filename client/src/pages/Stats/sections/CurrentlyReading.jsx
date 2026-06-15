import { Link } from 'react-router-dom';
import { initialsFor, plural } from '../../../utils.js';
import { FROM_STATS, Section } from '../shared.jsx';

// Books currently in progress with a pace projection. Renders nothing
// when the user has no active reads — keeps the page from sprouting
// empty sections in fresh-library state.
export default function CurrentlyReading({ inProgressPace = [] }) {
  if (inProgressPace.length === 0) return null;
  return (
    <Section title="Currently reading">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {inProgressPace.map(b => (
          <Link key={b.id} to={`/books/${b.id}`} state={FROM_STATS} className="bg-card rounded-lg p-3 flex items-center gap-3 hover:ring-1 hover:ring-neutral-600 transition-shadow">
            <div className="w-8 h-12 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
              {b.cover_path
                ? <img src={b.cover_path} alt="" className="w-full h-full object-cover object-top" />
                : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-[10px] text-neutral-500 font-medium tracking-wide">{initialsFor(b.title)}</div>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-neutral-200 truncate">{b.title}</p>
              <div className="mt-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-oak" style={{ width: `${b.pct ?? 0}%` }} />
              </div>
              <p className="text-xs text-neutral-600 mt-1 tabular-nums">
                {b.pct != null ? `${b.pct}%` : '—'}
                {b.projected_days_left != null
                  ? ` · ~${plural(b.projected_days_left, 'day')} left`
                  : ''}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </Section>
  );
}
