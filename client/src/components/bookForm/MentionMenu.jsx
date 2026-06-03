// Floating result list anchored to the textarea bottom-left. Mirrors
// LookupPanel's z-40 / styling so the picker reads as a sibling of the
// other form dropdowns. Uses onMouseDown rather than onClick so the
// textarea retains focus through the selection — onClick fires after
// blur, which would close the menu before the select handler runs.
export default function MentionMenu({ menu, results, onSelect, onClose }) {
  if (!menu) return null;
  return (
    <div className="absolute left-0 top-full mt-1 z-40 w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
      {results.length === 0 ? (
        <p className="text-xs text-neutral-500 px-3 py-2">
          {menu.query ? <>No matches for <span className="text-neutral-300">"{menu.query}"</span></> : 'Loading…'}
        </p>
      ) : (
        <ul className="max-h-64 overflow-auto">
          {results.map((b, i) => (
            <li key={b.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onSelect(i); }}
                className={`block w-full text-left px-3 py-1.5 text-xs leading-snug ${
                  i === menu.selectedIdx
                    ? 'bg-neutral-800 text-parchment'
                    : 'text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                <span className="text-neutral-500 mr-1.5">#{b.id}</span>
                <span className="text-neutral-200">{b.title}</span>
                {b.authors?.length > 0 && (
                  <span className="text-neutral-500"> — {b.authors.map(a => a.name).join(', ')}</span>
                )}
                {b.year_published && <span className="text-neutral-600"> · {b.year_published}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-neutral-800 px-3 py-1 text-[10px] text-neutral-600 flex justify-between">
        <span>↑↓ navigate · ⏎ select · Esc close</span>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onClose(); }} className="hover:text-neutral-400">close</button>
      </div>
    </div>
  );
}
