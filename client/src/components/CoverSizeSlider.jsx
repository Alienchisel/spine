// Discrete 9-stop range slider for the cover-size dial. Lives in
// cover-first grid headers (Library) and shares storage via the
// useCoverSize hook. Stop 1 = smallest covers (most per row); stop 9
// = biggest covers (fewest per row). The 3×3 grid glyph anchors the
// LEFT (dense) end so sliding right unambiguously means "bigger
// covers" — Plex's convention.

export default function CoverSizeSlider({ size, onChange, min = 1, max = 9 }) {
  return (
    <div className="flex items-center gap-1.5">
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-neutral-700">
        <rect x="1"   y="1"   width="3.5" height="3.5" rx="0.4"/>
        <rect x="6.25" y="1"   width="3.5" height="3.5" rx="0.4"/>
        <rect x="11.5" y="1"   width="3.5" height="3.5" rx="0.4"/>
        <rect x="1"   y="6.25" width="3.5" height="3.5" rx="0.4"/>
        <rect x="6.25" y="6.25" width="3.5" height="3.5" rx="0.4"/>
        <rect x="11.5" y="6.25" width="3.5" height="3.5" rx="0.4"/>
        <rect x="1"   y="11.5" width="3.5" height="3.5" rx="0.4"/>
        <rect x="6.25" y="11.5" width="3.5" height="3.5" rx="0.4"/>
        <rect x="11.5" y="11.5" width="3.5" height="3.5" rx="0.4"/>
      </svg>
      <input
        type="range"
        min={min}
        max={max}
        step="1"
        value={size}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-24 accent-oak cursor-pointer"
        title={`Cover size ${size} of ${max}`}
        aria-label="Cover size"
        aria-valuetext={size === min ? 'Smallest' : size === max ? 'Largest' : `Size ${size} of ${max}`}
      />
    </div>
  );
}
