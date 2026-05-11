import { useState, useRef, useEffect } from 'react';
import { api } from '../../api.js';
import { computeEta } from './eta.js';
import { getModeKey, initialProgressMode, computeProgressPatch, syncProgressInputs, progressDerived, clampMinutes } from '../progressMode.js';

export default function ProgressSection({ book, onChange, log }) {
  const { isAudiobook, hasPct, pct } = progressDerived(book);
  const modeKey = getModeKey(book.id);
  const [mode, setMode] = useState(() => {
    return initialProgressMode(localStorage.getItem(modeKey), isAudiobook, hasPct);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // `saving` (React state) drives the disabled UI but doesn't commit until
  // the next render — so two synchronous submit calls in the same tick
  // (Enter-key autorepeat, programmatic dispatch) both see saving === false
  // and fire duplicate patchBook calls. Ref mutates synchronously so the
  // second call sees the first's marker. Mirrors the busyIdsRef pattern in
  // ListPicker.
  const savingRef = useRef(false);

  // Re-clamp the persisted mode when the book's format or totals change
  // out from under us at runtime — e.g., the user toggles format on the
  // detail page and the same ProgressSection instance receives an updated
  // book whose current `mode` is no longer in the rendered <select>'s
  // options. Mount-time initialProgressMode alone doesn't catch this.
  // When the resolved mode differs from current, also refresh the
  // visible inputs so the always-on form doesn't render with a value
  // typed for the old mode (e.g. "42" entered as percent left sitting
  // in the page-count input). Read `mode` / `book` / `pct` from closure;
  // they're intentionally absent from deps because user-driven mode
  // changes and book mutations don't represent the kind of invalidation
  // this effect exists to handle.
  useEffect(() => {
    const next = initialProgressMode(localStorage.getItem(modeKey) ?? mode, isAudiobook, hasPct);
    if (next === mode) return;
    setMode(next);
    const inputs = syncProgressInputs({ book, isAudiobook, mode: next, pct });
    setInputVal(inputs.inputVal);
    setInputH(inputs.inputH);
    setInputM(inputs.inputM);
  }, [isAudiobook, hasPct, modeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const _initial = syncProgressInputs({ book, isAudiobook, mode, pct });
  const [inputVal, setInputVal] = useState(_initial.inputVal);
  const [inputH, setInputH] = useState(_initial.inputH);
  const [inputM, setInputM] = useState(_initial.inputM);

  function changeMode(m) {
    setMode(m);
    localStorage.setItem(modeKey, m);
    const inputs = syncProgressInputs({ book, isAudiobook, mode: m, pct });
    setInputVal(inputs.inputVal);
    setInputH(inputs.inputH);
    setInputM(inputs.inputM);
  }

  const isHMMode = isAudiobook && mode !== 'pct';
  const isEmpty = isHMMode ? (inputH === '' && inputM === '') : inputVal === '';


  async function handleSubmit(e) {
    e.preventDefault();
    // Mirror the disabled button. Double-fire near the page_count boundary
    // could double-trigger the auto-finish reads-row insert.
    if (savingRef.current || saving || isEmpty) return;

    // Compute the patch BEFORE arming the spinner. Splitting the
    // pure-compute step from the in-flight step avoids a stuck-spinner
    // footgun on validation early-returns. See computeProgressPatch.
    const { patchData, error: patchError } = computeProgressPatch({
      book, isAudiobook, mode, inputVal, inputH, inputM,
    });
    if (patchError) { setError(patchError); return; }

    setError(null);
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await api.patchBook(book.id, patchData);
      onChange(updated);
      const newPct = isAudiobook
        ? (updated.duration_minutes && updated.current_minutes != null
            ? Math.min(100, Math.round((updated.current_minutes / updated.duration_minutes) * 100)) : null)
        : (updated.page_count && updated.current_page != null
            ? Math.min(100, Math.round((updated.current_page / updated.page_count) * 100)) : null);
      const inputs = syncProgressInputs({ book: updated, isAudiobook, mode, pct: newPct });
      setInputVal(inputs.inputVal);
      setInputH(inputs.inputH);
      setInputM(inputs.inputM);
    } catch {
      setError('Failed to save');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const progressText = isAudiobook
    ? (book.current_minutes != null
        ? hasPct
          ? `${Math.floor(book.current_minutes / 60)}h ${book.current_minutes % 60}m of ${Math.floor(book.duration_minutes / 60)}h ${book.duration_minutes % 60}m · ${pct}%`
          : `${Math.floor(book.current_minutes / 60)}h ${book.current_minutes % 60}m`
        : 'No progress recorded yet')
    : (book.current_page
        ? hasPct
          ? `Page ${book.current_page} of ${book.page_count} · ${pct}%`
          : `Page ${book.current_page}`
        : 'No progress recorded yet');

  const remaining = isAudiobook
    ? (book.duration_minutes && book.current_minutes != null ? book.duration_minutes - book.current_minutes : null)
    : (book.page_count && book.current_page != null ? book.page_count - book.current_page : null);
  const eta = computeEta(log, remaining, isAudiobook);

  return (
    <div className="border border-neutral-800 rounded-lg p-4 mb-6">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
        {isAudiobook ? 'Listening progress' : 'Reading progress'}
      </p>

      <div className="h-2 bg-neutral-800 rounded-full overflow-hidden mb-2">
        <div className="h-full bg-oak rounded-full transition-all duration-300" style={{ width: `${pct ?? 0}%` }} />
      </div>

      <p className="text-sm text-neutral-400 mb-1">{progressText}</p>
      {eta ? (
        <p className="text-xs text-neutral-500 mb-3">
          ~{eta.sessions} {isAudiobook ? 'listening session' : 'reading day'}{eta.sessions !== 1 ? 's' : ''} remaining
          {eta.finishDate && <> · est. {eta.finishDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</>}
        </p>
      ) : (
        <div className="mb-3" />
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <select value={mode} onChange={(e) => changeMode(e.target.value)}
          className="bg-neutral-900 border border-neutral-700 text-neutral-300 text-sm rounded px-2 py-1.5 focus:outline-none">
          {isAudiobook ? (
            <>
              <option value="min">Time elapsed</option>
              {hasPct && <option value="remaining">Time remaining</option>}
            </>
          ) : (
            <option value="page">Page</option>
          )}
          {hasPct && <option value="pct">Percent</option>}
        </select>
        {isHMMode ? (
          <>
            <input
              type="number" min="0" max="999"
              value={inputH}
              onChange={(e) => { setError(null); setInputH(e.target.value); }}
              placeholder="0"
              className="w-16 bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-neutral-500 text-sm">h</span>
            <input
              type="number" min="0" max="59"
              value={inputM}
              onChange={(e) => { setError(null); setInputM(e.target.value); }}
              onBlur={(e) => setInputM(clampMinutes(e.target.value))}
              placeholder="0"
              className="w-16 bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-neutral-500 text-sm">m</span>
          </>
        ) : (
          <input
            type="number" min="0"
            max={mode === 'pct' ? 100 : (book.page_count || undefined)}
            value={inputVal}
            onChange={(e) => { setError(null); setInputVal(e.target.value); }}
            placeholder={mode === 'pct' ? 'e.g. 42' : 'e.g. 123'}
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors"
          />
        )}
        <button type="submit" disabled={saving || isEmpty}
          className="text-sm bg-binding hover:bg-binding/80 active:scale-[0.98] disabled:opacity-40 disabled:cursor-default text-parchment px-4 py-1.5 rounded transition-[transform,background-color] ease-out duration-150">
          {saving ? 'Saving…' : 'Update'}
        </button>
        {error && <p className="w-full text-xs text-warn mt-1">{error}</p>}
      </form>
    </div>
  );
}
