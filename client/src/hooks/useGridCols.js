import { useState, useEffect } from 'react';

// Breakpoint tables for the grid pages. Tailwind's sm/md correspond to
// 640px / 768px; matching those keeps grid math in sync with the className
// breakpoints applied to the actual <div className="grid grid-cols-...">.
export const COMFORTABLE_BPS = Object.freeze([{ minWidth: 0, cols: 3 }, { minWidth: 640, cols: 4 }, { minWidth: 768, cols: 6 }]);
export const COMPACT_BPS     = Object.freeze([{ minWidth: 0, cols: 6 }, { minWidth: 640, cols: 9 }, { minWidth: 768, cols: 12 }]);
export const BROWSE_BPS      = Object.freeze([{ minWidth: 0, cols: 3 }, { minWidth: 640, cols: 4 }, { minWidth: 768, cols: 5 }]);

// Returns the number of grid columns at the current viewport width given a
// breakpoint table. Each entry is { minWidth, cols }; the active row is the
// last entry whose minWidth is <= window.innerWidth. Re-runs on resize.
//
// Used by list pages to compute how many invisible-placeholder cells to
// append so the trailing grid row always reads as complete instead of
// half-filled.
export function useGridCols(breakpoints) {
  const [cols, setCols] = useState(() => computeCols(breakpoints));
  useEffect(() => {
    const update = () => setCols(computeCols(breakpoints));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [breakpoints]);
  return cols;
}

function computeCols(breakpoints) {
  if (typeof window === 'undefined') return breakpoints[0].cols;
  const w = window.innerWidth;
  let result = breakpoints[0].cols;
  for (const bp of breakpoints) {
    if (w >= bp.minWidth) result = bp.cols;
  }
  return result;
}
