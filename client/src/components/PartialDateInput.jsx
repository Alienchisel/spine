// Year / Month / Day picker for fields that accept partial dates (YYYY,
// YYYY-MM, YYYY-MM-DD). Used wherever the backend's isValidPartialDate
// applies — acquisition_date and reads.date_started/date_finished.
//
// Returns the current value via onChange as the same partial-date string
// the backend stores: '2024', '2024-06', or '2024-06-15'. Clearing the year
// (or passing an empty value in) yields ''.
//
// `size`:
//   'md' — full-form input scale (matches input/inputNoWidth in styles.js)
//   'sm' — inline scale (matches the chrome of ReadsSection rows)

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const SIZES = {
  md: {
    input:  'bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors duration-150',
    yearW:  'w-24',
    dayW:   'w-20',
  },
  sm: {
    input:  'bg-neutral-900 border border-neutral-700 text-neutral-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-neutral-500 transition-colors',
    yearW:  'w-20',
    dayW:   'w-16',
  },
};

export default function PartialDateInput({ value, onChange, size = 'md', ariaLabelPrefix }) {
  const sz = SIZES[size] || SIZES.md;
  const parts = (value || '').split('-');
  const year  = parts[0] || '';
  const month = parts[1] || '';
  const day   = parts[2] || '';

  function emit(y, m, d) {
    let v = y;
    if (y && m) { v = `${y}-${m}`; if (d) v = `${y}-${m}-${d}`; }
    onChange(v);
  }

  // The three controls are unlabelled in the form — placeholders give a
  // visual hint but vanish on focus and aren't reliably announced as
  // accessible names. Callers can pass `ariaLabelPrefix` (e.g.
  // "Acquisition") to qualify them in context; otherwise just "Year /
  // Month / Day" stands alone.
  const labelFor = (part) => ariaLabelPrefix ? `${ariaLabelPrefix} ${part}` : part;

  return (
    <div className="flex gap-2 items-center">
      <input
        type="number" min="1800" max="2099" placeholder="Year"
        aria-label={labelFor('year')}
        className={`${sz.yearW} ${sz.input}`}
        value={year}
        onChange={e => emit(e.target.value, year && month ? month : '', year && day ? day : '')}
      />
      <select
        aria-label={labelFor('month')}
        className={`flex-1 ${sz.input}`}
        value={month}
        onChange={e => emit(year, e.target.value, e.target.value ? day : '')}
      >
        <option value="">Month</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
        ))}
      </select>
      {month && (
        <input
          type="number" min="1" max="31" placeholder="Day"
          aria-label={labelFor('day')}
          className={`${sz.dayW} ${sz.input}`}
          value={day ? parseInt(day) : ''}
          onChange={e => emit(year, month, e.target.value ? String(parseInt(e.target.value)).padStart(2, '0') : '')}
        />
      )}
    </div>
  );
}
