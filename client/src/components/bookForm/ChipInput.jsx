import { forwardRef, useId } from 'react';
import { label as labelClass } from './styles.js';

// Reusable chip+input pattern. Used for authors, narrators, translators, and
// tags — all share the same UX: existing items shown as removable pills, an
// input that accepts new entries on Enter or comma, and a datalist of past
// values. Forwards refs to the internal <input> so callers (e.g. the audit
// wizard's per-card focus effect) can drive focus without reaching in.
export default forwardRef(function ChipInput({
  label,
  items,
  onItemsChange,
  inputValue,
  onInputChange,
  datalistId,
  datalistOptions,
  placeholder,
  inputClassName,
}, ref) {
  const inputId = useId();
  function commit() {
    // Split on commas so pasting "a, b, c" + Enter commits three chips
    // rather than one. Matches the keyhandler's per-comma commit. Each
    // part is trimmed individually, empties dropped, and the unique-set
    // check still skips chips already present.
    const parts = inputValue.split(',').map(s => s.trim()).filter(Boolean);
    const additions = parts.filter(p => !items.includes(p));
    if (additions.length > 0) onItemsChange([...items, ...additions]);
    onInputChange('');
  }

  function handleKey(e) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    commit();
  }

  function remove(item) {
    onItemsChange(items.filter(x => x !== item));
  }

  return (
    <div>
      <label htmlFor={inputId} className={labelClass}>{label}</label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {items.map((it) => (
            <span key={it} className="flex items-center gap-1 text-xs bg-neutral-800 text-neutral-300 px-2.5 py-1 rounded-full">
              {it}
              <button type="button" onClick={() => remove(it)}
                aria-label={`Remove ${it} from ${label.toLowerCase()}`}
                className="text-neutral-500 hover:text-white leading-none ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          id={inputId}
          className={inputClassName}
          list={datalistId}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={commit}
          disabled={!inputValue.trim()}
          aria-label={`Add ${label.toLowerCase()}`}
          className="text-xs text-oak hover:text-leather disabled:opacity-40 transition-colors flex-shrink-0"
        >
          add
        </button>
      </div>
      <datalist id={datalistId}>
        {datalistOptions.filter(o => !items.includes(o)).map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  );
});
