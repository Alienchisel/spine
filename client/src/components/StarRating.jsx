import { useState } from 'react';

function Star({ n, display }) {
  const filled = display >= n;
  const half = !filled && display >= n - 0.5;
  return (
    <span className="relative inline-block text-2xl leading-none select-none">
      <span className="text-neutral-700">★</span>
      {(filled || half) && (
        <span
          className="absolute inset-0 text-oak overflow-hidden"
          style={{ width: filled ? '100%' : '50%' }}
        >
          ★
        </span>
      )}
    </span>
  );
}

export default function StarRating({ value, onChange, readOnly = false }) {
  const [hover, setHover] = useState(null);
  const display = hover ?? value ?? 0;

  function handleClick(v) {
    if (readOnly) return;
    onChange(v === value ? null : v);
  }

  return (
    <div
      className="flex"
      onMouseLeave={() => !readOnly && setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} className={`relative ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}>
          <Star n={n} display={display} />
          {!readOnly && (
            <>
              <div
                className="absolute inset-0 w-1/2"
                onMouseEnter={() => setHover(n - 0.5)}
                onClick={() => handleClick(n - 0.5)}
              />
              <div
                className="absolute top-0 bottom-0 left-1/2 right-0"
                onMouseEnter={() => setHover(n)}
                onClick={() => handleClick(n)}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
