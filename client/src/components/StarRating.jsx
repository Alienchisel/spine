import { useState } from 'react';

function Star({ n, display, size }) {
  const filled = display >= n;
  const half = !filled && display >= n - 0.5;
  return (
    <span className={`relative inline-block ${size} leading-none select-none`}>
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

function clamp(v) {
  return Math.max(0, Math.min(5, v));
}

export default function StarRating({ value, onChange, readOnly = false, size = 'text-2xl', ariaLabel = 'Rating' }) {
  const [hover, setHover] = useState(null);
  const display = hover ?? value ?? 0;

  function handleClick(v) {
    if (readOnly) return;
    onChange(v === value ? null : v);
  }

  // Single ARIA slider for the whole row — arrow keys move in 0.5 steps,
  // Home / Delete / Backspace clear, End jumps to 5. The mouse click
  // handlers on individual stars keep working (and toggle off on a second
  // click of the same value).
  function handleKey(e) {
    if (readOnly) return;
    const cur = value ?? 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = clamp(cur + 0.5);
      if (next !== cur) onChange(next || 0.5);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      // At 0.5 a step left clears the rating entirely; below that is
      // already null so the keypress is a no-op.
      if (cur <= 0.5) onChange(null);
      else onChange(clamp(cur - 0.5));
    } else if (e.key === 'Home' || e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onChange(null);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(5);
    }
  }

  return (
    <div
      className="flex"
      role={readOnly ? undefined : 'slider'}
      aria-label={readOnly ? undefined : ariaLabel}
      aria-valuemin={readOnly ? undefined : 0}
      aria-valuemax={readOnly ? undefined : 5}
      aria-valuenow={readOnly ? undefined : (value ?? 0)}
      aria-valuetext={readOnly ? undefined : (value == null ? 'Not rated' : `${value} of 5`)}
      tabIndex={readOnly ? -1 : 0}
      onKeyDown={handleKey}
      onMouseLeave={() => !readOnly && setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} className={`relative ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}>
          <Star n={n} display={display} size={size} />
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
