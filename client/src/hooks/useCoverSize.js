import { useState, useEffect } from 'react';

// Plex-style cover-size dial: a discrete 9-stop slider that drives both
// the column count of cover-first grids and the BookCard's compact mode
// (which hides chrome on dense layouts). Stop 1 is smallest covers
// (most cols); stop 9 is biggest covers (fewest cols) — slide right to
// grow the covers, the direction Plex uses.
//
// Per-device persistence (1.244+): the slider's *meaning* differs across
// viewports — the same stop maps to different column counts at the
// mobile/sm/md breakpoints, and the same physical cover size requires
// very different stops on a 1440px monitor vs a 390px phone. Storing
// one shared value forced users into a zero-sum tradeoff: tune for
// mobile and desktop crammed; tune for desktop and mobile crammed.
// Keys split: `spine-cover-size-desktop` and `spine-cover-size-mobile`,
// each with its own default that's actually comfortable for that
// device class. The legacy `spine-cover-size` key gets one-time
// migrated into both (preserving the user's prior choice) so existing
// installs don't reset.

const LEGACY_STORAGE_KEY = 'spine-cover-size';
const STORAGE_KEY_DESKTOP = 'spine-cover-size-desktop';
const STORAGE_KEY_MOBILE  = 'spine-cover-size-mobile';
const DEFAULT_SIZE_DESKTOP = 7;  // 6 cols at md+ ≈ 240px covers — the prior global default.
const DEFAULT_SIZE_MOBILE  = 8;  // 2 cols at <640px ≈ 170px covers — bigger than the prior
                                  // 3-col default which produced ~110px covers on iPhone.
const MIN = 1;
const MAX = 9;

const MOBILE_BREAKPOINT = 640;

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function storageKeyForViewport(isMobile) {
  return isMobile ? STORAGE_KEY_MOBILE : STORAGE_KEY_DESKTOP;
}

function defaultSizeForViewport(isMobile) {
  return isMobile ? DEFAULT_SIZE_MOBILE : DEFAULT_SIZE_DESKTOP;
}

// One-time migration from the pre-1.244 single-key storage. Copies the
// legacy value into BOTH new keys so the user's prior tuning carries
// over on whichever device they next open Spine on. Leaves the legacy
// key intact (harmless; would only matter if the user downgraded).
let legacyMigrated = false;
function migrateLegacyKey() {
  if (legacyMigrated) return;
  legacyMigrated = true;
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === null) return;
    if (localStorage.getItem(STORAGE_KEY_MOBILE) === null) {
      localStorage.setItem(STORAGE_KEY_MOBILE, legacy);
    }
    if (localStorage.getItem(STORAGE_KEY_DESKTOP) === null) {
      localStorage.setItem(STORAGE_KEY_DESKTOP, legacy);
    }
  } catch {}
}

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

function loadSize(isMobile) {
  migrateLegacyKey();
  try {
    const raw = parseInt(localStorage.getItem(storageKeyForViewport(isMobile)) || '', 10);
    if (Number.isInteger(raw) && raw >= MIN && raw <= MAX) return raw;
  } catch {}
  return defaultSizeForViewport(isMobile);
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
  const [mobileNow, setMobileNow] = useState(isMobileViewport);
  const [size, _setSize] = useState(() => loadSize(isMobileViewport()));
  const [cols, setCols] = useState(() => computeCols(loadSize(isMobileViewport())));

  useEffect(() => {
    setCols(computeCols(size));
    function onResize() {
      const m = isMobileViewport();
      if (m !== mobileNow) {
        // Crossed the mobile/desktop boundary — switch to the other
        // key's persisted value so a tablet rotating to landscape (or
        // a dev tools viewport resize) picks up the right setting for
        // the new device class.
        setMobileNow(m);
        _setSize(loadSize(m));
        return;
      }
      setCols(computeCols(size));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [size, mobileNow]);

  function setSize(n) {
    const fallback = defaultSizeForViewport(mobileNow);
    const clamped = Math.max(MIN, Math.min(MAX, Math.round(Number(n) || fallback)));
    _setSize(clamped);
    try { localStorage.setItem(storageKeyForViewport(mobileNow), String(clamped)); } catch {}
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
