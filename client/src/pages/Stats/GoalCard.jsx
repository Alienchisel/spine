import { useState } from 'react';

// One progress-bar tile in the Goals row. The current count reads as
// a hero number (slab-serif, large, parchment) so the row sits at the
// same visual weight as the headline tiles above it; the goal half is
// the smaller "/ N" suffix that doubles as the edit affordance.
// `color` paints the progress bar (bg-oak / bg-leather).
export default function GoalCard({ label, current, goal, onSave, onEditStart, color = 'bg-oak' }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0;

  function handleSubmit(e) {
    e.preventDefault();
    const val = parseInt(input);
    // Reject blank / zero / negative submissions: keep the editor open so
    // the user has a visible signal their input wasn't accepted, instead of
    // the form silently collapsing as if it took.
    if (isNaN(val) || val <= 0) return;
    onSave(val);
    setEditing(false);
  }

  function startEdit() {
    onEditStart?.();
    setInput(goal ? String(goal) : '');
    setEditing(true);
  }

  return (
    <div className="bg-card rounded-lg p-5 space-y-3">
      <p className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">{label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-slab text-4xl text-parchment tabular-nums leading-none">{current.toLocaleString()}</span>
        {editing ? (
          <form onSubmit={handleSubmit} className="flex items-baseline gap-1.5">
            <span className="text-sm text-neutral-500">/</span>
            <input
              type="number" min="1" autoFocus
              value={input} onChange={e => setInput(e.target.value)}
              // Keep the editor open if blur is the result of clicking the
              // "set" button — its onSubmit will commit and close. Any
              // other blur (Esc, click-outside) cancels by closing without
              // saving, matching the original behaviour.
              onBlur={(e) => { if (e.relatedTarget?.type === 'submit') return; setEditing(false); }}
              aria-label={`Set ${label.toLowerCase()} goal`}
              className="w-20 bg-neutral-800 border border-neutral-600 text-parchment text-sm rounded px-2 py-0.5 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button type="submit" className="text-xs text-oak hover:text-leather transition-colors">set</button>
          </form>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors tabular-nums"
            aria-label={goal ? `Edit ${label.toLowerCase()} goal` : `Set ${label.toLowerCase()} goal`}
          >
            / {goal ? goal.toLocaleString() : <span className="text-neutral-700">set goal</span>}
          </button>
        )}
      </div>
      <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {goal > 0 && (
        <p className="text-xs text-neutral-600">{pct}%{pct >= 100 ? ' — goal reached!' : ''}</p>
      )}
    </div>
  );
}
