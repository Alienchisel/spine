import { useState, useEffect } from 'react';

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
