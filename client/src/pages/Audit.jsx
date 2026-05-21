import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

const FROM_AUDIT = { from: 'Audit', fromPath: '/audit' };

// The Archivist — visual library-health indicator beneath the hero %.
// Six states: two rare bookends (Pristine at exactly 100%, Collapsed at
// exactly 0%) bracketing four quarter-sized common states. Image asset
// for each state lives at client/public/audit-archivist/<key>.png; the
// placeholder div renders the state label until art is ready.
function archivistState(cleanPct) {
  if (cleanPct === 100) return { key: 'pristine',   label: 'Pristine'   };
  if (cleanPct >= 75)   return { key: 'tidy',       label: 'Tidy'       };
  if (cleanPct >= 50)   return { key: 'manageable', label: 'Manageable' };
  if (cleanPct >= 25)   return { key: 'troubled',   label: 'Troubled'   };
  if (cleanPct > 0)     return { key: 'critical',   label: 'Critical'   };
  return                       { key: 'collapsed',  label: 'Collapsed'  };
}

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
  const atCeiling = summary.cleanPct === 100;
  const cleanPctLabel = atCeiling
    ? '100%'
    : summary.cleanPct >= 99.995
      ? '99.99%'
      : `${summary.cleanPct.toFixed(2)}%`;
  // Single earned-it reward: hero tints warm at literal 100%; sits as
  // restrained parchment the rest of the time. No spectrum, no
  // continuous coloring — just the one moment.
  const heroColor = atCeiling ? 'text-oak' : 'text-parchment';
  const archivist = archivistState(summary.cleanPct);

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
          <p className={`font-slab text-7xl sm:text-8xl tabular-nums leading-none tracking-tight ${heroColor}`}>{cleanPctLabel}</p>
          <p className="text-xs text-neutral-500 mt-4">
            {summary.totalGaps.toLocaleString()} outstanding gaps across {summary.rowCount} audits.
          </p>
          <p className="text-xs text-neutral-600 mt-2">
            Resolved audits show <span className="text-neutral-500">✓</span>.
          </p>

          {/* The Archivist — visual library-health indicator. Six PNGs
              will live at /audit-archivist/<key>.png (place files at
              client/public/audit-archivist/). Until the art is ready,
              the slot renders as a bordered placeholder with the state
              name. Swap the inner `<span>` for `<img src=... />` when
              the illustrations land. */}
          <figure className="mt-6">
            <div
              className="aspect-[3/4] rounded-sm border border-neutral-700 bg-neutral-800/60 flex items-center justify-center"
              aria-hidden="true"
            >
              <span className="text-neutral-600 text-[10px] font-slab uppercase tracking-wider">
                Archivist · {archivist.label}
              </span>
            </div>
            <figcaption className="text-[10px] text-neutral-600 uppercase tracking-wider mt-2 text-center">
              {archivist.label}
            </figcaption>
          </figure>
        </div>

        <div className="space-y-6 min-w-0" aria-label="Audit groups">
          {audit.map(group => (
            <section key={group.heading} aria-labelledby={`audit-group-${group.heading.replace(/\s+/g, '-').toLowerCase()}`}>
              <h2 id={`audit-group-${group.heading.replace(/\s+/g, '-').toLowerCase()}`} className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-2">{group.heading}</h2>
              <ul className="space-y-1">
                {group.rows.map(row => {
                  const resolved = row.count === 0;
                  // % clean = how much of this audit's eligible population
                  // is already past the gap. Aligned with the hero's
                  // direction (higher = better) so every percentage on
                  // the page points the same way. The count cell still
                  // reports work-remaining; the % reports
                  // progress-made — count drives action, % drives morale.
                  // Pop=0 only happens when count=0 (can't have a gap in
                  // an empty set), which is already the resolved branch.
                  const rowCleanPct = row.population > 0
                    ? ((row.population - row.count) / row.population) * 100
                    : 100;
                  // count > 0 in this branch, so the row isn't truly
                  // 100% clean — clamp to 99.9% so the display doesn't
                  // claim a ceiling it hasn't reached. Use one decimal
                  // at the extremes (near-clean / near-broken) where
                  // visible progress is in the fraction; whole percent
                  // in the middle band where rounding is fine.
                  const rowPctLabel = rowCleanPct >= 99.95
                    ? '99.9%'
                    : (rowCleanPct >= 90 || rowCleanPct < 10)
                      ? `${rowCleanPct.toFixed(1)}%`
                      : `${Math.round(rowCleanPct)}%`;
                  // Count cell shows "count / population" so the absolute
                  // gap and its scope sit side by side; the % cell at the
                  // far right gives the ratio at a glance. Resolved rows
                  // collapse to a single ✓ and skip the right-side cells.
                  const countCell = resolved
                    ? <span className="text-neutral-600 text-sm tabular-nums w-24 text-right" aria-label="resolved">✓</span>
                    : <span className="text-sm tabular-nums w-24 text-right">
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
                          <span className="text-xs text-neutral-500 tabular-nums w-12 text-right">{rowPctLabel}</span>
                          <span className="text-neutral-700 ml-1 group-hover:text-neutral-400 transition-colors" aria-hidden="true">→</span>
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
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
