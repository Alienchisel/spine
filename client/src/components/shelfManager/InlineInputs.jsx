import { useState, useEffect, useRef } from 'react';

export function InlineInput({ placeholder, onSave, onCancel }) {
  const [val, setVal] = useState('');
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);
  // Enter is handled by the form's onSubmit (browser default for a single
  // input inside a form). Escape doesn't have a default behavior, so we
  // wire it up here.
  function handleKey(e) {
    if (e.key === 'Escape') onCancel();
  }
  return (
    <form onSubmit={e => { e.preventDefault(); if (val.trim()) onSave(val.trim()); }} className="flex items-center gap-1.5">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKey}
        aria-label={placeholder}
        placeholder={placeholder}
        className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 w-36"
      />
      <button type="submit" disabled={!val.trim()} className="text-xs text-oak hover:text-leather disabled:opacity-40 transition-colors">add</button>
      <button type="button" onClick={onCancel} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">cancel</button>
    </form>
  );
}

export function InlineEdit({ value, onSave, onCancel, ariaLabel = 'Rename' }) {
  const [val, setVal] = useState(value);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  // Enter is handled by the form's onSubmit (browser default for a single
  // input inside a form). Escape doesn't have a default behavior, so we
  // wire it up here.
  function handleKey(e) {
    if (e.key === 'Escape') onCancel();
  }
  return (
    <form onSubmit={e => { e.preventDefault(); if (val.trim()) onSave(val.trim()); }} className="flex items-center gap-1.5">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKey}
        aria-label={ariaLabel}
        className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-oak/50 w-36"
      />
      <button type="submit" disabled={!val.trim()} className="text-xs text-oak hover:text-leather disabled:opacity-40 transition-colors">save</button>
      <button type="button" onClick={onCancel} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">cancel</button>
    </form>
  );
}
