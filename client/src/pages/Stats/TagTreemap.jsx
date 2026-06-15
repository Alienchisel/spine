import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { plural } from '../../utils.js';
import { FROM_STATS } from './shared.jsx';

// Squarified treemap layout (Bruls, Huijsen, van Wijk 2000) for a flat
// list of weighted items. Returns each input augmented with a normalised
// rect = { x, y, w, h } in the virtual coordinate space (vw × vh).
// We greedily fill the current strip with items while their worst-case
// aspect ratio keeps improving, then close the strip and recurse on the
// remaining rect — gives near-square tiles for typical long-tail data.
function squarify(items, vw, vh) {
  const sorted = [...items].sort((a, b) => b.value - a.value).filter(d => d.value > 0);
  if (sorted.length === 0) return [];
  const total = sorted.reduce((s, d) => s + d.value, 0);
  const scaled = sorted.map(d => ({ ...d, area: (d.value / total) * vw * vh }));
  const out = [];
  layoutRect(scaled, 0, 0, vw, vh, out);
  return out;
}

function worstAspect(row, shortSide) {
  if (row.length === 0) return Infinity;
  const rowArea = row.reduce((s, it) => s + it.area, 0);
  const thickness = rowArea / shortSide;
  let worst = 0;
  for (const it of row) {
    const longDim = it.area / thickness;
    const r = Math.max(thickness / longDim, longDim / thickness);
    if (r > worst) worst = r;
  }
  return worst;
}

function layoutRect(items, x, y, w, h, out) {
  if (items.length === 0 || w <= 0 || h <= 0) return;
  let i = 0;
  let row = [];
  while (i < items.length) {
    const shortSide = Math.min(w, h);
    const candidate = [...row, items[i]];
    if (row.length === 0 || worstAspect(candidate, shortSide) <= worstAspect(row, shortSide)) {
      row = candidate;
      i++;
    } else {
      break;
    }
  }
  const shortSide = Math.min(w, h);
  const rowArea = row.reduce((s, it) => s + it.area, 0);
  const thickness = rowArea / shortSide;
  if (w >= h) {
    let off = 0;
    for (const it of row) {
      const ih = it.area / thickness;
      out.push({ ...it, rect: { x, y: y + off, w: thickness, h: ih } });
      off += ih;
    }
    layoutRect(items.slice(i), x + thickness, y, w - thickness, h, out);
  } else {
    let off = 0;
    for (const it of row) {
      const iw = it.area / thickness;
      out.push({ ...it, rect: { x: x + off, y, w: iw, h: thickness } });
      off += iw;
    }
    layoutRect(items.slice(i), x, y + thickness, w, h - thickness, out);
  }
}

// Bookish palette for treemap tiles — warm umbers, oxblood, tan, slate.
// Per-tag color is name-hashed so the same tag keeps the same color across
// renders and sessions; the visualization becomes recognizable over time.
const TREEMAP_COLORS = [
  '#a97954', '#c29b87', '#6a5d4f', '#532c2e',
  '#5a7a8a', '#7d6149', '#8c6f54', '#4a3d3a',
];

function colorForTag(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TREEMAP_COLORS[Math.abs(h) % TREEMAP_COLORS.length];
}

export default function TagTreemap({ tags }) {
  const containerRef = useRef(null);
  // Measure the rendered container so squarify optimises aspect ratios
  // against the actual shape we hand the user. Without this, tiles are
  // laid out for a fixed virtual square and visibly stretched whenever
  // the rendered cell isn't 1:1 (e.g. when the cell stretches to match
  // the donut block's height beside it).
  const [size, setSize] = useState({ w: 400, h: 400 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!tags || tags.length === 0) return null;
  const placed = squarify(
    tags.map(t => ({ name: t.name, value: t.count, count: t.count })),
    size.w,
    size.h,
  );
  return (
    <div ref={containerRef} className="bg-card rounded-lg p-1 h-full min-h-[24rem] relative overflow-hidden">
      {placed.map(t => (
        <Link
          key={t.name}
          to={`/browse/tag/${encodeURIComponent(t.name)}`}
          state={FROM_STATS}
          className="absolute border border-neutral-900 transition-[filter] hover:brightness-125 flex items-center justify-center overflow-hidden text-center"
          style={{
            left:       `${(t.rect.x / size.w) * 100}%`,
            top:        `${(t.rect.y / size.h) * 100}%`,
            width:      `${(t.rect.w / size.w) * 100}%`,
            height:     `${(t.rect.h / size.h) * 100}%`,
            background: colorForTag(t.name),
          }}
          title={`${t.name} · ${plural(t.count, 'book')}`}
        >
          <span className="text-xs text-parchment leading-tight px-1 truncate">{t.name}</span>
        </Link>
      ))}
    </div>
  );
}
