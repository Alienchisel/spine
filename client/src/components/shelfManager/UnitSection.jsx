import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragHandle from './DragHandle.jsx';
import ShelfRow from './ShelfRow.jsx';
import { InlineInput, InlineEdit } from './InlineInputs.jsx';

function UnitSection({ unit, dragHandle, onEdit, onDelete, onAddShelf, onEditShelf, onDeleteShelf }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  if (editing) return (
    <div className="py-1.5 pl-10">
      <InlineEdit value={unit.name} onSave={v => { onEdit(unit.id, v); setEditing(false); }} onCancel={() => setEditing(false)} />
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between py-1.5 pl-10 pr-2 group">
        <div className="flex items-center gap-1 min-w-0">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">{dragHandle}</span>
          <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-left min-w-0">
            <span className="text-neutral-600 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
            <span className="text-xs text-neutral-300">{unit.name}</span>
            <span className="text-xs text-neutral-600 ml-1">{unit.shelves.length} {unit.shelves.length === 1 ? 'shelf' : 'shelves'}</span>
          </button>
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {open && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors whitespace-nowrap">+ shelf</button>
          )}
          <button onClick={() => setEditing(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">✎</button>
          <button onClick={() => onDelete(unit.id)} className="text-xs text-neutral-600 hover:text-warn transition-colors">×</button>
        </div>
      </div>
      {open && (
        <div>
          {unit.shelves.map(s => (
            <ShelfRow key={s.id} shelf={s} onEdit={onEditShelf} onDelete={onDeleteShelf} />
          ))}
          {adding && (
            <div className="pl-16 py-1.5">
              <InlineInput placeholder="e.g. 1, Top, A…"
                onSave={v => { onAddShelf(unit.id, v); setAdding(false); }}
                onCancel={() => setAdding(false)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SortableUnit({ unit, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: unit.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className={isDragging ? 'opacity-40' : ''}>
      <UnitSection unit={unit} dragHandle={<DragHandle listeners={listeners} />} {...props} />
    </div>
  );
}
