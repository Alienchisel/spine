import { useCallback, useRef, useState } from 'react';

// Names the "sync ref + async state" double-submit guard idiom used
// throughout Spine. React state setters don't commit until the next
// render, so two same-tick fires of a handler both read state === false
// and dispatch duplicate requests; the ref check closes that window.
// State still drives UI (disabled buttons, spinners).
//
// Usage:
//   const guard = useActionGuard();
//   async function handle() {
//     if (!guard.begin()) return;          // false if already in flight
//     try { await api.foo(); } finally { guard.end(); }
//   }
//   <button disabled={guard.busy}>Save</button>
//
// `isBusy()` reads the sync ref — use it when something other than the
// component itself needs the up-to-date flag in the same tick begin()
// runs (e.g. BookForm's useBlocker callback, which fires before the
// setBusy commit and would otherwise see the stale render-state busy).
//
// Each guard owns one action. Multiple independent actions on the same
// component each get their own useActionGuard() — mirrors how the old
// hand-rolled refs were paired one-per-action (savingRef + saving,
// finishingRef + finishing, etc.).
export function useActionGuard() {
  const [busy, setBusy] = useState(false);
  const ref = useRef(false);
  const begin = useCallback(() => {
    if (ref.current) return false;
    ref.current = true;
    setBusy(true);
    return true;
  }, []);
  const end = useCallback(() => {
    ref.current = false;
    setBusy(false);
  }, []);
  const isBusy = useCallback(() => ref.current, []);
  return { busy, begin, end, isBusy };
}
