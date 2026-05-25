import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

// Top N sources get their own panel; everything else collapses into
// "Other" so the long tail of single-source bookstores doesn't drown out
// the comparison. 6 fits comfortably in a 3-wide grid.
const TOP_N_SOURCES = 6;

// Pivot the flat (year, source, count) rows the server returns into
// per-source year arrays, aligned to a shared year axis. Sources are
// ranked by total; the long tail collapses into "Other".
function buildPanels(rows) {
  if (!rows?.length) return { panels: [], years: [], yMax: 0 };

  const totalsBySource = new Map();
  const cellsBySource = new Map();
  const yearSet = new Set();

  for (const r of rows) {
    const y = r.year;
    const s = r.source;
    const c = r.count;
    yearSet.add(y);
    totalsBySource.set(s, (totalsBySource.get(s) || 0) + c);
    if (!cellsBySource.has(s)) cellsBySource.set(s, new Map());
    cellsBySource.get(s).set(y, c);
  }

  const years = Array.from(yearSet).sort();
  const ranked = Array.from(totalsBySource.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, TOP_N_SOURCES);
  const rest = ranked.slice(TOP_N_SOURCES);

  const panels = top.map(([source, total]) => ({
    source,
    total,
    values: years.map(y => cellsBySource.get(source).get(y) || 0),
  }));

  if (rest.length > 0) {
    const otherCells = new Map();
    let otherTotal = 0;
    for (const [source] of rest) {
      otherTotal += totalsBySource.get(source);
      for (const [y, c] of cellsBySource.get(source)) {
        otherCells.set(y, (otherCells.get(y) || 0) + c);
      }
    }
    panels.push({
      source: `Other (${rest.length})`,
      total: otherTotal,
      values: years.map(y => otherCells.get(y) || 0),
    });
  }

  // Shared y-scale across all panels so totals are visually comparable.
  // Round up to the next multiple of 10 for a calmer ceiling, but never
  // round down past the actual max.
  const dataMax = panels.reduce((m, p) => Math.max(m, ...p.values), 0);
  const yMax = Math.max(10, Math.ceil(dataMax / 10) * 10);

  return { panels, years, yMax };
}

// Single panel — minimal SVG bar chart. Range-framed x-axis (the line
// spans only the active data extent, not a padded margin) and only the
// first/last year are labelled in text; the gap is left to be inferred
// from the bar positions, which is enough at this resolution. y-scale
// label is suppressed (it's the same on every panel — shared scale is
// the whole point of a small-multiples display, and printing the same
// number on every panel would fail the eraser test).
function Panel({ source, total, values, years, yMax }) {
  // Viewbox math: 200 wide, 60 tall plot area, plus a 12-unit footer
  // strip for the year ticks. Padding kept tight so the data dominates.
  const W = 200, H = 60, FOOT = 12;
  const n = values.length;
  const gap = 1;
  const barW = (W - gap * (n - 1)) / n;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-parchment">{source}</span>
        <span className="text-neutral-500 tabular-nums">{total}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + FOOT}`} className="w-full h-auto" preserveAspectRatio="none">
        {/* Bars. fill in the binding tone keeps the chart on-palette with
            the rest of the app; height encodes the year's count against
            the shared yMax. */}
        {values.map((v, i) => {
          const h = (v / yMax) * H;
          const x = i * (barW + gap);
          const y = H - h;
          return (
            <rect
              key={years[i]}
              x={x}
              y={y}
              width={barW}
              height={h}
              fill="#b8896a"
            >
              <title>{`${years[i]}: ${v}`}</title>
            </rect>
          );
        })}
        {/* Range-framed baseline — line spans the data extent only. */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#525252" strokeWidth={0.4} />
        {/* First-year and last-year ticks: small text, neutral colour. */}
        <text x={0}     y={H + FOOT - 2} fontSize="6" fill="#737373">{years[0]}</text>
        <text x={W}     y={H + FOOT - 2} fontSize="6" fill="#737373" textAnchor="end">{years[years.length - 1]}</text>
      </svg>
    </div>
  );
}

export default function DataViz() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getStats()
      .then(setStats)
      .catch(() => setError('Failed to load stats.'));
  }, []);

  const { panels, years, yMax } = useMemo(
    () => buildPanels(stats?.acquiredByYearAndSource),
    [stats],
  );

  if (error) return <div role="alert" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">{error}</div>;
  if (!stats) return <div role="status" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-neutral-700 text-sm">Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Data visualization</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Experiment #1 — Acquisitions by source, {years[0]}–{years[years.length - 1]}. Small multiples with a shared y-scale ({yMax}/yr ceiling), so the eye can compare each source's tempo against the others. Top {TOP_N_SOURCES} sources by total; the rest collapse into the Other panel.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
        {panels.map(p => (
          <Panel key={p.source} {...p} years={years} yMax={yMax} />
        ))}
      </div>
    </div>
  );
}
