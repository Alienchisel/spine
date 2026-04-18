export default function StarRating({ value, onChange, readOnly = false }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => !readOnly && onChange(n === value ? null : n)}
          className={`text-2xl leading-none transition-colors ${
            n <= (value || 0) ? 'text-oak' : 'text-neutral-700'
          } ${readOnly ? 'cursor-default' : 'hover:text-leather cursor-pointer'}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
