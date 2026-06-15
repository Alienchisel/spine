import { useState } from 'react';

// One progress-bar tile in the Goals row: label, current count, editable
// target, and a fill bar coloured by `color`. Edit mode swaps the count
// row for an inline number input; submit fires `onSave(value)`.
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

  return (
    <div className="bg-card rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">{label}</span>
        {editing ? (
          <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
            <input
              type="number" min="1" autoFocus
              value={input} onChange={e => setInput(e.target.value)}
              onBlur={(e) => { if (e.relatedTarget?.type === 'submit') return; setEditing(false); }}
              aria-label={`Set ${label.toLowerCase()} goal`}
              className="w-16 bg-neutral-800 border border-neutral-600 text-parchment text-xs rounded px-2 py-0.5 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button type="submit" className="text-xs text-oak hover:text-leather transition-colors">set</button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => { onEditStart?.(); setInput(goal ? String(goal) : ''); setEditing(true); }}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors tabular-nums"
          >
            {current.toLocaleString()} / {goal ? goal.toLocaleString() : <span className="text-neutral-700">set goal</span>}
          </button>
        )}
      </div>
      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {goal > 0 && (
        <p className="text-xs text-neutral-600">{pct}%{pct >= 100 ? ' — goal reached!' : ''}</p>
      )}
    </div>
  );
}
