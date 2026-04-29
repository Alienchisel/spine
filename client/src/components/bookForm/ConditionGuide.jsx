import { useState, useEffect, useRef } from 'react';

const CONDITION_GRADES = [
  { grade: 'New',       desc: 'Unread, no defects whatsoever' },
  { grade: 'Fine',      desc: 'Like new, imperceptible wear' },
  { grade: 'Very Good', desc: 'Minor wear, no damage' },
  { grade: 'Good',      desc: 'Average used copy, visible wear' },
  { grade: 'Fair',      desc: 'Heavily worn but complete and readable' },
  { grade: 'Poor',      desc: 'Damaged; may have writing or missing pages' },
];

export default function ConditionGuide() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-4 h-4 rounded-full border text-xs leading-none flex items-center justify-center transition-colors ${
          open
            ? 'border-oak/60 text-oak'
            : 'border-neutral-600 text-neutral-500 hover:border-neutral-400 hover:text-neutral-300'
        }`}
      >
        ?
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-20 w-64 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-3 space-y-2.5">
          {CONDITION_GRADES.map(({ grade, desc }) => (
            <div key={grade} className="flex gap-2.5">
              <span className="text-xs font-semibold text-neutral-300 w-20 flex-shrink-0">{grade}</span>
              <span className="text-xs text-neutral-500 leading-relaxed">{desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
