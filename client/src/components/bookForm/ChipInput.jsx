import { label as labelClass } from './styles.js';

// Reusable chip+input pattern. Used for authors, narrators, and tags — all
// share the same UX: existing items shown as removable pills, an input that
// accepts new entries on Enter or comma, and a datalist of past values.
export default function ChipInput({
  label,
  items,
  onItemsChange,
  inputValue,
  onInputChange,
  datalistId,
  datalistOptions,
  placeholder,
  inputClassName,
}) {
  function add(e) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const value = inputValue.trim().replace(/,$/, '');
    if (value && !items.includes(value)) onItemsChange([...items, value]);
    onInputChange('');
  }

  function remove(item) {
    onItemsChange(items.filter(x => x !== item));
  }

  return (
    <div>
      <label className={labelClass}>{label}</label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {items.map((it) => (
            <span key={it} className="flex items-center gap-1 text-xs bg-neutral-800 text-neutral-300 px-2.5 py-1 rounded-full">
              {it}
              <button type="button" onClick={() => remove(it)}
                className="text-neutral-500 hover:text-white leading-none ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
      <input
        className={inputClassName}
        list={datalistId}
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={add}
        placeholder={placeholder}
      />
      <datalist id={datalistId}>
        {datalistOptions.filter(o => !items.includes(o)).map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  );
}
