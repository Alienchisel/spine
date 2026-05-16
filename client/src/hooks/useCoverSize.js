import { useState, useEffect } from 'react';

// Plex-style cover-size dial: a discrete 9-stop slider that drives both
// the column count of cover-first grids and the BookCard's compact mode
// (which hides chrome on dense layouts). Stop 1 is smallest covers
// (most cols); stop 9 is biggest covers (fewest cols) — slide right to
// grow the covers, the direction Plex uses. Stop 7 is the default —
// matches what was previously hard-coded as "comfortable".
//
// Persisted under `spine-cover-size` so the setting follows the user
// across surfaces (Library now; ShelfView / Loved / BrowsePage on the
// next pass).

const STORAGE_KEY = 'spine-cover-size';
const DEFAULT_SIZE = 7;
const MIN = 1;
const MAX = 9;

// Each stop maps to a column count at three breakpoints (mobile / sm /
// md+). 1-indexed for the slider value; index 0 is a placeholder so
// `STOPS[size]` lines up with the user-visible 1-9 dial.
const STOPS = [
  null,
  { mobile: 6, sm: 9, md: 12 },  // 1 — smallest covers (was "compact")
  { mobile: 5, sm: 8, md: 11 },  // 2
  { mobile: 5, sm: 7, md: 10 },  // 3
  { mobile: 4, sm: 6, md: 9  },  // 4 — compact mode ends here
  { mobile: 4, sm: 5, md: 8  },  // 5
  { mobile: 3, sm: 4, md: 7  },  // 6
  { mobile: 3, sm: 4, md: 6  },  // 7 — default (was "comfortable")
  { mobile: 2, sm: 3, md: 5  },  // 8
  { mobile: 2, sm: 2, md: 4  },  // 9 — biggest covers
];

// Threshold at which BookCard's `compact` prop trips: hides on-cover
// chrome (hover-tray buttons, error pill, reading-progress bar) since
// they don't read at this card width anyway. Stops 1-4 are compact;
// stops 5-9 have enough room for chrome.
const COMPACT_AT = 4;

function loadSize() {
  try {
    const raw = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
    if (Number.isInteger(raw) && raw >= MIN && raw <= MAX) return raw;
  } catch {}
  return DEFAULT_SIZE;
}

function computeCols(size) {
  if (typeof window === 'undefined') return STOPS[size].mobile;
  const w = window.innerWidth;
  const s = STOPS[size];
  if (w >= 768) return s.md;
  if (w >= 640) return s.sm;
  return s.mobile;
}

export function useCoverSize() {
  const [size, _setSize] = useState(loadSize);
  const [cols, setCols] = useState(() => computeCols(loadSize()));

  useEffect(() => {
    setCols(computeCols(size));
    function onResize() { setCols(computeCols(size)); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [size]);

  function setSize(n) {
    const clamped = Math.max(MIN, Math.min(MAX, Math.round(Number(n) || DEFAULT_SIZE)));
    _setSize(clamped);
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch {}
  }

  return {
    size,
    setSize,
    cols,
    compact: size <= COMPACT_AT,
    // Inline style for the grid container — Tailwind's static class
    // scanner won't pick up dynamically-built `grid-cols-N` strings,
    // and there'd be 9 × 3 = 27 variants anyway. Inline keeps the
    // matrix in one place.
    gridStyle: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` },
    // Gap pairs with compact so cards collapse to a denser layout
    // without per-card chrome competing for space.
    gridClassName: size <= COMPACT_AT ? 'grid items-start gap-0.5' : 'grid items-start gap-x-3 gap-y-5',
    MIN, MAX,
  };
}
