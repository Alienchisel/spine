import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

const FROM_AUDIT = { from: 'Audit', fromPath: '/audit' };

// Curation health. Companion to Stats: where Stats describes the shape
// of the catalogue, Audit surfaces completeness gaps that represent
// real cleanup work. The audit list is opinionated (see lib/stats/
// audit.js) — power-user `missing=` filters not on this list remain
// available from the Library filter panel and the Command Palette.
export default function Audit() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const refreshTick = useRefreshTick();
  const loadGuard = useStaleGuard();

  useEffect(() => {
    const epoch = loadGuard.next();
    api.getStats()
      .then(s => { if (loadGuard.isFresh(epoch)) { setStats(s); setError(null); } })
      .catch(() => { if (loadGuard.isFresh(epoch)) setError('Failed to load audit data'); });
  }, [refreshTick]);

  if (!stats && error) return <div role="alert" className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">{error}</div>;
  if (!stats) return null;

  const audit = stats.audit || [];
  const summary = stats.auditSummary || { cleanPct: 100, totalGaps: 0, totalPopulation: 0, rowCount: audit.reduce((s, g) => s + g.rows.length, 0) };
  // One decimal until we're near the ceiling; whole percent below
  // that — avoids a meaningless "100.0%" while a single gap remains.
  const cleanPctLabel = summary.cleanPct >= 99.95
    ? '100%'
    : `${summary.cleanPct.toFixed(1)}%`;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Library audit</h1>
        <Link to="/stats" state={FROM_AUDIT} className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors">
          ← Stats
        </Link>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <p className="text-sm text-neutral-500">
        <span className="text-parchment tabular-nums">{cleanPctLabel} clean</span>
        {' · '}
        {summary.totalGaps.toLocaleString()} outstanding gaps across {summary.rowCount} audits.
        Resolved audits show <span className="text-neutral-400">✓</span>.
      </p>

      <div className="space-y-6">
        {audit.map(group => (
          <div key={group.heading}>
            <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-2">{group.heading}</p>
            <ul className="space-y-1">
              {group.rows.map(row => {
                const resolved = row.count === 0;
                const countCell = resolved
                  ? <span className="text-neutral-600 text-sm tabular-nums w-10 text-right">✓</span>
                  : <span className="text-parchment text-sm tabular-nums w-10 text-right">{row.count.toLocaleString()}</span>;
                // Resolved rows aren't actionable — keep them visible
                // for the "all clear" signal but skip the link wrapper.
                const inner = (
                  <>
                    {countCell}
                    <span className={`text-sm ${resolved ? 'text-neutral-600' : 'text-neutral-300'}`}>{row.label}</span>
                    {!resolved && <span className="text-neutral-700 ml-auto group-hover:text-neutral-400 transition-colors">→</span>}
                  </>
                );
                return (
                  <li key={row.label}>
                    {resolved
                      ? <div className="flex items-center gap-3 px-2 py-1">{inner}</div>
                      : <Link to={`/?${row.query}`} state={FROM_AUDIT} className="group flex items-center gap-3 px-2 py-1 rounded hover:bg-neutral-900/50 transition-colors">{inner}</Link>
                    }
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
