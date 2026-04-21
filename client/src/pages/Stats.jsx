import { useState, useEffect } from 'react';
import { api } from '../api.js';

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-card rounded-lg p-4">
      <div className="text-2xl font-semibold text-parchment">{value ?? '—'}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-neutral-600 mt-1">{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Bar({ label, count, max, color = 'bg-oak' }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-neutral-400 w-28 flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-neutral-500 w-8 text-right">{count}</span>
    </div>
  );
}

function formatHours(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h.toLocaleString()}h ${m}m` : `${h.toLocaleString()}h`;
}

const FORMAT_LABEL = { physical: 'Physical', ebook: 'E-book', audiobook: 'Audiobook' };

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getStats().then(setStats).catch(() => setError('Failed to load stats'));
  }, []);

  if (error) return <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">{error}</div>;
  if (!stats) return null;

  const { totals, formats, fiction, ratings, pagesRead, minutesListened, byYear, topAuthors, streaks } = stats;

  const maxRating = Math.max(...ratings.map(r => r.count), 1);
  const maxYear   = Math.max(...byYear.map(y => y.count), 1);
  const maxAuthor = Math.max(...topAuthors.map(a => a.count), 1);
  const maxFormat = Math.max(...formats.map(f => f.count), 1);

  const fictionTotal = (fiction.fiction ?? 0) + (fiction.nonfiction ?? 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Stats</h1>

      <Section title="Library">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total books" value={totals.books?.toLocaleString()} />
          <StatCard label="Owned" value={totals.owned?.toLocaleString()} />
          <StatCard label="Finished" value={totals.finished?.toLocaleString()} />
          <StatCard label="Reading" value={totals.reading?.toLocaleString()} />
          <StatCard label="Paused" value={totals.paused?.toLocaleString()} />
          <StatCard label="Unread" value={totals.unread?.toLocaleString()} />
        </div>
      </Section>

      <Section title="Reading">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Pages read" value={pagesRead?.toLocaleString()} />
          <StatCard label="Time listened" value={formatHours(minutesListened)} />
        </div>
      </Section>

      <Section title="Streaks">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card rounded-lg p-4 space-y-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Daily</p>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-2xl font-semibold text-parchment">{streaks.days.current}</div>
                <div className="text-xs text-neutral-500 mt-0.5">current</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-neutral-400">{streaks.days.longest}</div>
                <div className="text-xs text-neutral-600 mt-0.5">longest</div>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-lg p-4 space-y-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Weekly</p>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-2xl font-semibold text-parchment">{streaks.weeks.current}</div>
                <div className="text-xs text-neutral-500 mt-0.5">current</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-neutral-400">{streaks.weeks.longest}</div>
                <div className="text-xs text-neutral-600 mt-0.5">longest</div>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-lg p-4 space-y-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Monthly</p>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-2xl font-semibold text-parchment">{streaks.months.current}</div>
                <div className="text-xs text-neutral-500 mt-0.5">current</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-neutral-400">{streaks.months.longest}</div>
                <div className="text-xs text-neutral-600 mt-0.5">longest</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <Section title="Format">
          <div className="space-y-2.5">
            {formats.filter(f => f.format).map(f => (
              <Bar key={f.format} label={FORMAT_LABEL[f.format] ?? f.format} count={f.count} max={maxFormat} />
            ))}
            {formats.some(f => !f.format) && (
              <Bar label="Unknown" count={formats.find(f => !f.format).count} max={maxFormat} color="bg-neutral-600" />
            )}
          </div>
        </Section>

        <Section title="Fiction / Non-fiction">
          <div className="space-y-2.5">
            <Bar label="Fiction" count={fiction.fiction ?? 0} max={fictionTotal || 1} color="bg-leather" />
            <Bar label="Non-fiction" count={fiction.nonfiction ?? 0} max={fictionTotal || 1} color="bg-binding" />
            {fiction.unset > 0 && (
              <Bar label="Unset" count={fiction.unset} max={totals.books || 1} color="bg-neutral-600" />
            )}
          </div>
        </Section>

        <Section title="Ratings">
          <div className="space-y-2.5">
            {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map(r => {
              const entry = ratings.find(x => x.rating === r);
              if (!entry) return null;
              const full = Math.floor(r);
              const half = r % 1 !== 0;
              return (
                <Bar
                  key={r}
                  label={'★'.repeat(full) + (half ? '½' : '')}
                  count={entry.count}
                  max={maxRating}
                  color="bg-oak"
                />
              );
            })}
            {ratings.length === 0 && <p className="text-xs text-neutral-600">No ratings yet</p>}
          </div>
        </Section>

        {topAuthors.length > 0 && (
          <Section title="Top authors">
            <div className="space-y-2.5">
              {topAuthors.map(a => (
                <Bar key={a.author} label={a.author} count={a.count} max={maxAuthor} color="bg-binding" />
              ))}
            </div>
          </Section>
        )}
      </div>

      {byYear.length > 0 && (
        <Section title="Finished by year">
          <div className="space-y-2.5">
            {byYear.map(y => (
              <Bar key={y.year} label={y.year} count={y.count} max={maxYear} color="bg-leather" />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
