import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useFreshFetch } from '../hooks/useFreshFetch.js';
import { useSpineEvent } from '../hooks/useSpineEvent.js';
import ErrorBanner from '../components/ErrorBanner.jsx';
import PageHeading from '../components/PageHeading.jsx';
import { AuditSkeleton } from '../components/Skeleton.jsx';

const FROM_AUDIT = { from: 'Audit', fromPath: '/audit' };

// The Archivist — visual library-health indicator beneath the hero %.
// Six states matching the source-image taxonomy: two rare bookends
// (Pristine at exactly 100%, Collapsed at exactly 0%) bracketing four
// quarter-sized common states (Well Kept 76-99, Manageable 51-75,
// Troubled 26-50, Critical 1-25). Image asset for each state lives at
// client/public/audit-archivist/<key>.png; until art is ready, the
// placeholder div renders the state label.
function archivistState(cleanPct) {
  if (cleanPct === 100) return { key: 'pristine',   label: 'Pristine'   };
  if (cleanPct >= 76)   return { key: 'well_kept',  label: 'Well Kept'  };
  if (cleanPct >= 51)   return { key: 'manageable', label: 'Manageable' };
  if (cleanPct >= 26)   return { key: 'troubled',   label: 'Troubled'   };
  if (cleanPct > 0)     return { key: 'critical',   label: 'Critical'   };
  return                       { key: 'collapsed',  label: 'Collapsed'  };
}

// TEMPORARY — preview strip showing all six Archivist states. Used to
// verify final art across the cleanPct range without having to drive
// the library % to each bucket. Remove the strip (and the previewKey
// state) once the six portraits are all in.
// Range strings mirror the archivistState() thresholds — Pristine is the
// literal ceiling, Collapsed the literal floor, the rest split the
// middle into 25-point bands. The tooltip composes "Label · range" so a
// hovering reader can map state to cleanPct at a glance.
const ALL_ARCHIVIST_STATES = [
  { key: 'pristine',   label: 'Pristine',   range: '100%'   },
  { key: 'well_kept',  label: 'Well Kept',  range: '76–99%' },
  { key: 'manageable', label: 'Manageable', range: '51–75%' },
  { key: 'troubled',   label: 'Troubled',   range: '26–50%' },
  { key: 'critical',   label: 'Critical',   range: '1–25%'  },
  { key: 'collapsed',  label: 'Collapsed',  range: '0%'     },
];

// Module-level cache so route changes don't pay for the heavyweight
// audit scan (~40 SUM(CASE) over the books table) on every visit.
// Same shape as Stats: seed initialData on remount, refetch in the
// background, invalidate on book mutations. Audit's hit-rate is
// probably lower than Stats — the typical flow is "look → edit a
// book → revisit" — but each cache hit saves a noticeably bigger
// scan, so the win per hit is higher.
let auditCache = null;

// Curation health. Companion to Stats: where Stats describes the shape
// of the catalogue, Audit surfaces completeness gaps that represent
// real cleanup work. The audit list is opinionated (see lib/stats/
// audit.js) — power-user `missing=` filters not on this list remain
// available from the Library filter panel and the Command Palette.
export default function Audit() {
  const { data, loading, error, setError } = useFreshFetch(
    () => api.getAudit().then(d => { auditCache = d; return d; }),
    [],
    { initialData: auditCache },
  );
  // TEMPORARY — hover/focus key for the preview strip. null = display
  // the real cleanPct-derived state.
  const [previewKey, setPreviewKey] = useState(null);

  // Book mutations invalidate the audit snapshot — almost any edit
  // moves a row in or out of a gap bucket, so cleanPct and the per-row
  // counts go stale immediately. The current mount keeps rendering its
  // existing data; the next /audit visit hits the server.
  useSpineEvent('spine:book-mutated', () => { auditCache = null; });
  useSpineEvent('spine:book-deleted', () => { auditCache = null; });

  if (!data && error) return <div role="alert" className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">Failed to load audit data.</div>;
  if (!data && loading) return <AuditSkeleton />;

  const audit = data.audit || [];
  const summary = data.auditSummary || { cleanPct: 100, totalGaps: 0, totalPopulation: 0, rowCount: audit.reduce((s, g) => s + g.rows.length, 0) };
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
  // TEMPORARY — overlay the previewed state on top of the real one when
  // the user is hovering/focusing a thumbnail in the preview strip.
  const displayed = previewKey
    ? (ALL_ARCHIVIST_STATES.find(s => s.key === previewKey) || archivist)
    : archivist;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4">
        <PageHeading>Library audit</PageHeading>
        <Link to="/stats" state={FROM_AUDIT} className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors">
          ← Stats
        </Link>
      </div>

      <ErrorBanner message={error ? 'Failed to load audit data.' : null} onDismiss={() => setError(null)} />

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
              live at client/public/audit-archivist/<key>.png, served at
              /audit-archivist/<key>.png. The state.label below the
              image carries the caption; aria-label on the figure ties
              the image to its meaning for screen readers. */}
          <figure className="mt-6" aria-label={`Library state: ${displayed.label}`}>
            <div className="aspect-[2/3] rounded-sm border border-neutral-700 bg-neutral-800/60 overflow-hidden">
              <img
                src={`/audit-archivist/${displayed.key}.png`}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            <figcaption className="text-[10px] text-neutral-600 uppercase tracking-wider mt-2 text-center">
              {displayed.label}
            </figcaption>
          </figure>

          {/* TEMPORARY — preview strip. Hover (or focus) a thumbnail to
              swap the main portrait + caption to that state without
              touching the underlying library %. The current real state
              is outlined in oak. Remove this whole block when all six
              final illustrations are confirmed. */}
          <div className="mt-3 grid grid-cols-6 gap-1" aria-label="Preview Archivist states">
            {ALL_ARCHIVIST_STATES.map(s => {
              const isReal = s.key === archivist.key;
              const isShown = s.key === displayed.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onMouseEnter={() => setPreviewKey(s.key)}
                  onMouseLeave={() => setPreviewKey(null)}
                  onFocus={() => setPreviewKey(s.key)}
                  onBlur={() => setPreviewKey(null)}
                  aria-label={`Preview ${s.label} (${s.range})${isReal ? ' — current' : ''}`}
                  title={`${s.label} · ${s.range}`}
                  className={`aspect-[2/3] rounded-sm overflow-hidden border transition-colors ${
                    isReal     ? 'border-oak' :
                    isShown    ? 'border-neutral-400' :
                                 'border-neutral-700 hover:border-neutral-500'
                  }`}
                >
                  <img src={`/audit-archivist/${s.key}.png`} alt="" className="w-full h-full object-cover" />
                </button>
              );
            })}
          </div>
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
                  // Count cell shows "<satisfied>/<population>". The
                  // foreground number matches the positive label direction
                  // (higher = better, aligned with the % cell at the far
                  // right); the missing count is implicit in the slash form
                  // (population − satisfied). Resolved rows collapse to a
                  // single ✓ and skip the right-side cells.
                  // Clamp at 0 — a data inconsistency where gap > population
                  // (e.g. a delete that bumped the gap query against a stale
                  // snapshot) would otherwise render a negative count.
                  const satisfied = Math.max(0, row.population - row.count);
                  const countCell = resolved
                    ? <span className="text-neutral-600 text-sm tabular-nums w-32 text-right" aria-label="resolved">✓</span>
                    : <span className="text-sm tabular-nums w-32 text-right">
                        <span className="text-parchment">{satisfied.toLocaleString()}</span>
                        <span className="text-neutral-600 ml-1">/&nbsp;{row.population.toLocaleString()}</span>
                      </span>;
                  // Resolved rows aren't actionable — keep them visible
                  // for the "all clear" signal but skip the link wrapper.
                  // Always reserve the % column so the values align across
                  // resolved/unresolved rows. Resolved rows render an empty
                  // spacer of the same width.
                  const pctCell = resolved
                    ? <span className="w-12 flex-shrink-0" aria-hidden="true" />
                    : <span className="text-xs text-neutral-500 tabular-nums w-12 text-right">{rowPctLabel}</span>;
                  const inner = (
                    <>
                      {countCell}
                      <span className={`text-sm flex-1 ${resolved ? 'text-neutral-600' : 'text-neutral-300'}`}>{row.label}</span>
                      {pctCell}
                    </>
                  );
                  // Path defaults to '/' for backward compatibility; author
                  // audits supply '/authors' so the click-through lands on
                  // the right index.
                  const href = `${row.path || '/'}?${row.query}`;
                  // Wand slot — fixed width so the ✨ button (or its
                  // absence) lands at the same x-position on every row.
                  // The Link sits outside the row Link so clicking the
                  // wand doesn't also trigger the row-level filter jump.
                  const wandSlot = !resolved && row.wizardKey ? (
                    <Link
                      to={`/audit/wizard/${row.wizardKey}`}
                      state={FROM_AUDIT}
                      aria-label={`Open fill wizard for ${row.label}`}
                      title="Open fill wizard"
                      className="w-7 flex-shrink-0 flex items-center justify-center text-neutral-600 hover:text-oak transition-colors"
                      onClick={e => e.stopPropagation()}
                    >
                      ✨
                    </Link>
                  ) : (
                    <span className="w-7 flex-shrink-0" aria-hidden="true" />
                  );
                  return (
                    <li key={row.label}>
                      <div className={`flex items-center rounded ${!resolved ? 'hover:bg-neutral-900/50 transition-colors' : ''}`}>
                        {resolved
                          ? <div className="flex items-center gap-3 px-2 py-1 flex-1 min-w-0">{inner}</div>
                          : <Link to={href} state={FROM_AUDIT} className="flex items-center gap-3 px-2 py-1 flex-1 min-w-0">{inner}</Link>
                        }
                        {wandSlot}
                      </div>
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
