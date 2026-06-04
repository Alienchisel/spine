import { useState, useRef, useEffect } from 'react';

// Inline "+ New list…" affordance shared by ListPicker and MoreMenu's
// add-to-lists sub-prompt. Default view is a quiet button; clicking
// swaps it for a text input. Enter or the ✓ button submits via
// onCreate(name); Esc or ✕ cancels back to the button.
//
// onCreate is async — the caller's createListAndAdd handles the POSTs
// and the optimistic UI update. While the call is in flight the input
// is disabled and a 'Creating…' placeholder shows. On success we
// auto-collapse back to the button so subsequent rapid creates don't
// need an extra click. On failure the input stays open with the error
// from the hook surfaced inline.
export default function NewListInput({ onCreate, creating, createError, clearCreateError }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Auto-collapse + reset after a successful create. The hook's caller
  // can't tell us "creating just finished" directly, so we watch the
  // creating flag — once it flips back to false AND there's no
  // createError, the create succeeded and we close.
  const prevCreatingRef = useRef(creating);
  useEffect(() => {
    if (prevCreatingRef.current && !creating && !createError) {
      setEditing(false);
      setName('');
    }
    prevCreatingRef.current = creating;
  }, [creating, createError]);

  function start() {
    clearCreateError?.();
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setName('');
    clearCreateError?.();
  }
  async function submit(e) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!name.trim() || creating) return;
    try { await onCreate(name); } catch { /* hook surfaces createError */ }
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === 'Enter') submit(e);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 transition-colors border-t border-neutral-800 mt-1"
      >
        <span aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0 text-center leading-none">+</span>
        <span>New list…</span>
      </button>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-neutral-800 mt-1">
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => { clearCreateError?.(); setName(e.target.value); }}
          onKeyDown={onKeyDown}
          disabled={creating}
          placeholder="List name"
          aria-label="New list name"
          maxLength={120}
          className="flex-1 min-w-0 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-parchment placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!name.trim() || creating}
          aria-label="Create list"
          title="Create"
          className="text-xs text-oak hover:text-leather disabled:opacity-60 disabled:cursor-default transition-colors px-1.5"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel"
          title="Cancel"
          className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors px-1.5"
        >
          ✕
        </button>
      </form>
      {createError && (
        <p role="alert" className="text-[11px] text-warn mt-1">{createError}</p>
      )}
    </div>
  );
}
