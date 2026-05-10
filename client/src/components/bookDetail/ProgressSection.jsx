import { useState, useRef, useEffect } from 'react';
import { api } from '../../api.js';
import { computeEta } from './eta.js';
import { getModeKey, initialProgressMode } from '../progressMode.js';

export default function ProgressSection({ book, onChange, log }) {
  const isAudiobook = book.format === 'audiobook';
  const modeKey = getModeKey(book.id);
  const [mode, setMode] = useState(() => {
    const initialHasPct = isAudiobook ? Boolean(book.duration_minutes) : Boolean(book.page_count);
    return initialProgressMode(localStorage.getItem(modeKey), isAudiobook, initialHasPct);
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

  const pct = isAudiobook
    ? (book.duration_minutes && book.current_minutes != null
        ? Math.min(100, Math.round((book.current_minutes / book.duration_minutes) * 100))
        : null)
    : (book.page_count && book.current_page != null
        ? Math.min(100, Math.round((book.current_page / book.page_count) * 100))
        : null);
  const hasPct = isAudiobook ? Boolean(book.duration_minutes) : Boolean(book.page_count);

  // Re-clamp the persisted mode when the book's format or totals change
  // out from under us at runtime — e.g., the user toggles format on the
  // detail page and the same ProgressSection instance receives an updated
  // book whose current `mode` is no longer in the rendered <select>'s
  // options. Mount-time initialProgressMode alone doesn't catch this.
  useEffect(() => {
    setMode(prev => initialProgressMode(localStorage.getItem(modeKey) ?? prev, isAudiobook, hasPct));
  }, [isAudiobook, hasPct, modeKey]);

  // For the 'remaining' mode, the h/m inputs represent time-remaining; we
  // convert to/from current_minutes at the input/submit boundary.
  function audioMinutesForMode(m, b) {
    if (b.current_minutes == null) return null;
    if (m === 'remaining') {
      if (!b.duration_minutes) return null;
      return Math.max(0, b.duration_minutes - b.current_minutes);
    }
    return b.current_minutes;
  }

  const rawVal = () => {
    if (mode === 'pct') return pct !== null ? String(pct) : '';
    if (isAudiobook) return '';
    return book.current_page != null ? String(book.current_page) : '';
  };
  const [inputVal, setInputVal] = useState(rawVal);
  const [inputH, setInputH] = useState(() => {
    if (!isAudiobook || mode === 'pct') return '';
    const mins = audioMinutesForMode(mode, book);
    return mins != null ? String(Math.floor(mins / 60)) : '';
  });
  const [inputM, setInputM] = useState(() => {
    if (!isAudiobook || mode === 'pct') return '';
    const mins = audioMinutesForMode(mode, book);
    return mins != null ? String(mins % 60) : '';
  });

  function changeMode(m) {
    setMode(m);
    localStorage.setItem(modeKey, m);
    if (m === 'pct') {
      setInputVal(pct !== null ? String(pct) : '');
    } else if (isAudiobook) {
      const mins = audioMinutesForMode(m, book);
      setInputH(mins != null ? String(Math.floor(mins / 60)) : '');
      setInputM(mins != null ? String(mins % 60) : '');
    } else {
      setInputVal(book.current_page != null ? String(book.current_page) : '');
    }
  }

  const isHMMode = isAudiobook && mode !== 'pct';
  const isEmpty = isHMMode ? (inputH === '' && inputM === '') : inputVal === '';

  function clampMinutes(val) {
    const n = parseInt(val);
    if (isNaN(n)) return '';
    return String(Math.min(59, Math.max(0, n)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // Mirror the disabled button. Double-fire near the page_count boundary
    // could double-trigger the auto-finish reads-row insert.
    if (savingRef.current || saving || isEmpty) return;

    // Build and validate the patch BEFORE arming the spinner. Validation
    // returns inside try { } would still hit finally and reset `saving`
    // (JS semantics), but mixing "compute" with "in-flight" inside the
    // same try-block reads like a stuck-spinner footgun. Split the phases.
    let patchData;
    if (isAudiobook) {
      const enteredMinutes = (parseInt(inputH) || 0) * 60 + (parseInt(inputM) || 0);
      let current_minutes;
      if (mode === 'pct') {
        current_minutes = Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.duration_minutes);
      } else if (mode === 'remaining') {
        if (!book.duration_minutes) { setError('Duration unknown'); return; }
        current_minutes = Math.max(0, Math.min(book.duration_minutes, book.duration_minutes - enteredMinutes));
      } else {
        current_minutes = enteredMinutes;
      }
      if (isNaN(current_minutes)) { setError('Invalid value'); return; }
      patchData = { current_minutes };
    } else {
      const current_page = mode === 'pct'
        ? Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.page_count)
        : Math.max(0, parseInt(inputVal));
      if (isNaN(current_page)) { setError('Invalid value'); return; }
      patchData = { current_page };
    }

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
      if (mode === 'pct') {
        setInputVal(newPct !== null ? String(newPct) : '');
      } else if (isAudiobook) {
        const mins = audioMinutesForMode(mode, updated);
        setInputH(mins != null ? String(Math.floor(mins / 60)) : '');
        setInputM(mins != null ? String(mins % 60) : '');
      } else {
        setInputVal(updated.current_page != null ? String(updated.current_page) : '');
      }
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
