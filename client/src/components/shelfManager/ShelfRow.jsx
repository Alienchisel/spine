import { useState } from 'react';
import { InlineEdit } from './InlineInputs.jsx';

export default function ShelfRow({ shelf, dragHandle, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  if (editing) return (
    <div className="flex items-center gap-2 py-1.5 pl-16">
      <InlineEdit value={shelf.label} onSave={v => { onEdit(shelf.id, v); setEditing(false); }} onCancel={() => setEditing(false)} />
    </div>
  );
  return (
    <div className="flex items-center justify-between py-1.5 pl-16 pr-2 group">
      <div className="flex items-center gap-1">
        {dragHandle && <span className="opacity-30 group-hover:opacity-100 transition-opacity">{dragHandle}</span>}
        <span className="text-xs text-neutral-400">{shelf.label}</span>
        {shelf.book_count > 0 && (
          <span className="text-xs text-neutral-600">· {shelf.book_count} {shelf.book_count === 1 ? 'book' : 'books'}</span>
        )}
      </div>
      <div className="flex items-center gap-2 opacity-30 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setEditing(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">✎</button>
        <button onClick={() => onDelete(shelf.id)} className="text-xs text-neutral-600 hover:text-warn transition-colors">×</button>
      </div>
    </div>
  );
}
