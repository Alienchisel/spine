import { useState, useEffect } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragHandle from './DragHandle.jsx';
import SortableUnit from './UnitSection.jsx';
import { InlineInput, InlineEdit } from './InlineInputs.jsx';

function RoomSection({ room, dragHandle, onEdit, onDelete, onAddUnit, onReorderUnits, onEditUnit, onDeleteUnit, onAddShelf, onEditShelf, onDeleteShelf, onReorderShelves }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [units, setUnits] = useState(room.units);
  useEffect(() => setUnits(room.units), [room.units]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleUnitDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = units.findIndex(u => u.id === active.id);
    const newIdx = units.findIndex(u => u.id === over.id);
    const reordered = arrayMove(units, oldIdx, newIdx);
    setUnits(reordered);
    onReorderUnits(room.id, reordered.map(u => u.id));
  }

  if (editing) return (
    <div className="py-1.5 pl-6">
      <InlineEdit value={room.name} onSave={v => { onEdit(room.id, v); setEditing(false); }} onCancel={() => setEditing(false)} />
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between py-1.5 pl-6 pr-2 group">
        <div className="flex items-center gap-1 min-w-0">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">{dragHandle}</span>
          <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-left min-w-0">
            <span className="text-neutral-600 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
            <span className="text-xs text-neutral-200">{room.name}</span>
            <span className="text-xs text-neutral-600 ml-1">{room.units.length} {room.units.length === 1 ? 'unit' : 'units'}</span>
          </button>
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {open && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors whitespace-nowrap">+ unit</button>
          )}
          <button onClick={() => setEditing(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">✎</button>
          <button onClick={() => onDelete(room.id)} className="text-xs text-neutral-600 hover:text-warn transition-colors">×</button>
        </div>
      </div>
      {open && (
        <div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleUnitDragEnd}>
            <SortableContext items={units.map(u => u.id)} strategy={verticalListSortingStrategy}>
              {units.map(u => (
                <SortableUnit key={u.id} unit={u}
                  onEdit={onEditUnit} onDelete={onDeleteUnit}
                  onAddShelf={onAddShelf} onEditShelf={onEditShelf} onDeleteShelf={onDeleteShelf}
                  onReorderShelves={onReorderShelves} />
              ))}
            </SortableContext>
          </DndContext>
          {adding && (
            <div className="pl-10 py-1.5">
              <InlineInput placeholder="e.g. Bookcase A, Desk…"
                onSave={v => { onAddUnit(room.id, v); setAdding(false); }}
                onCancel={() => setAdding(false)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SortableRoom({ room, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: room.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className={isDragging ? 'opacity-40' : ''}>
      <RoomSection room={room} dragHandle={<DragHandle listeners={listeners} />} {...props} />
    </div>
  );
}
