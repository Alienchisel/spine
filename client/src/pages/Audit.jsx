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
  if (!stats) return <div role="status" className="text-neutral-700 text-sm">Loading…</div>;

  const audit = stats.audit || [];
  const summary = stats.auditSummary || { cleanPct: 100, totalGaps: 0, totalPopulation: 0, rowCount: audit.reduce((s, g) => s + g.rows.length, 0) };
  // Two decimals everywhere except the literal 100% case. The
  // intermediate clamp keeps a near-ceiling reading (e.g. 99.998) from
  // displaying as the misleading "100.00%" — when not actually at the
  // ceiling, cap at "99.99%" so the number stays honest.
  const cleanPctLabel = summary.cleanPct === 100
    ? '100%'
    : summary.cleanPct >= 99.995
      ? '99.99%'
      : `${summary.cleanPct.toFixed(2)}%`;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Library audit</h1>
        <Link to="/stats" state={FROM_AUDIT} className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors">
          ← Stats
        </Link>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-10">
        {/* Hero column — sticky on md+ so the score stays in view while
            you scroll the audit list. Stacks above on narrow viewports. */}
        <div className="md:sticky md:top-8 md:self-start">
          <p className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wider mb-2">Library clean</p>
          <p className="font-slab text-7xl sm:text-8xl text-parchment tabular-nums leading-none tracking-tight">{cleanPctLabel}</p>
          <p className="text-xs text-neutral-500 mt-4">
            {summary.totalGaps.toLocaleString()} outstanding gaps across {summary.rowCount} audits.
          </p>
          <p className="text-xs text-neutral-600 mt-2">
            Resolved audits show <span className="text-neutral-500">✓</span>.
          </p>
        </div>

        <div className="space-y-6 min-w-0">
          {audit.map(group => (
            <div key={group.heading}>
              <p className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-2">{group.heading}</p>
              <ul className="space-y-1">
                {group.rows.map(row => {
                  const resolved = row.count === 0;
                  // % open = how much of this audit's eligible population
                  // still has the gap. Inverse of the hero "% clean", but
                  // rows describe gaps ("books missing X"), so open %
                  // reads more naturally next to the row's count than
                  // clean % would. Edge case: pop=0 only happens when
                  // count=0 too (can't have a gap in an empty set), which
                  // is already the resolved branch.
                  const openPct = row.population > 0
                    ? (row.count / row.population) * 100
                    : 0;
                  const openPctLabel = openPct >= 99.95
                    ? '100%'
                    : openPct >= 10
                      ? `${Math.round(openPct)}%`
                      : `${openPct.toFixed(1)}%`;
                  // Count cell shows "count / population" so the absolute
                  // gap and its scope sit side by side; the % cell at the
                  // far right gives the ratio at a glance. Resolved rows
                  // collapse to a single ✓ and skip the right-side cells.
                  const countCell = resolved
                    ? <span className="text-neutral-600 text-sm tabular-nums w-20 text-right">✓</span>
                    : <span className="text-sm tabular-nums w-20 text-right">
                        <span className="text-parchment">{row.count.toLocaleString()}</span>
                        <span className="text-neutral-600 ml-1">/&nbsp;{row.population.toLocaleString()}</span>
                      </span>;
                  // Resolved rows aren't actionable — keep them visible
                  // for the "all clear" signal but skip the link wrapper.
                  const inner = (
                    <>
                      {countCell}
                      <span className={`text-sm flex-1 ${resolved ? 'text-neutral-600' : 'text-neutral-300'}`}>{row.label}</span>
                      {!resolved && (
                        <>
                          <span className="text-xs text-neutral-500 tabular-nums w-12 text-right">{openPctLabel}</span>
                          <span className="text-neutral-700 ml-1 group-hover:text-neutral-400 transition-colors">→</span>
                        </>
                      )}
                    </>
                  );
                  // Path defaults to '/' for backward compatibility; author
                  // audits supply '/authors' so the click-through lands on
                  // the right index.
                  const href = `${row.path || '/'}?${row.query}`;
                  return (
                    <li key={row.label}>
                      {resolved
                        ? <div className="flex items-center gap-3 px-2 py-1">{inner}</div>
                        : <Link to={href} state={FROM_AUDIT} className="group flex items-center gap-3 px-2 py-1 rounded hover:bg-neutral-900/50 transition-colors">{inner}</Link>
                      }
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
