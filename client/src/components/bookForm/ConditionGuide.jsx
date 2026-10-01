import { useState, useRef } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside.js';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';
import { enumOptions } from '../../../../shared/bookFields.js';

const CONDITION_DESC = {
  new:         'Unread, no defects whatsoever',
  fine:        'Like new, imperceptible wear',
  'very good': 'Minor wear, no damage',
  good:        'Average used copy, visible wear',
  fair:        'Heavily worn but complete and readable',
  poor:        'Damaged; may have writing or missing pages',
};
const CONDITION_GRADES = enumOptions('condition').map(o => ({ grade: o.label, desc: CONDITION_DESC[o.value] }));

export default function ConditionGuide() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  useClickOutside(ref, () => setOpen(false), open);
  useEscapeKey(() => { setOpen(false); buttonRef.current?.focus(); }, open);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Condition grading guide"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`w-4 h-4 rounded-full border text-xs leading-none flex items-center justify-center transition-colors ${
          open
            ? 'border-oak/60 text-oak'
            : 'border-neutral-600 text-neutral-500 hover:border-neutral-400 hover:text-neutral-300'
        }`}
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Condition grading guide"
          className="absolute left-0 top-6 z-20 w-64 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-3 space-y-2.5"
        >
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
