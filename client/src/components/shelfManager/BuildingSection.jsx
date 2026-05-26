import { useState, useEffect } from 'react';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { plural } from '../../utils.js';
import DragHandle from './DragHandle.jsx';
import SortableRoom from './RoomSection.jsx';
import { InlineInput, InlineEdit } from './InlineInputs.jsx';
import { PROXIMITY_LABEL, PROXIMITY_OPTIONS } from './proximity.js';

function BuildingSection({ building, dragHandle, onEdit, onDelete, onAddRoom, onEditRoom, onDeleteRoom,
  onAddUnit, onReorderUnits, onEditUnit, onDeleteUnit, onAddShelf, onEditShelf, onDeleteShelf,
  onReorderShelves, onReorderRooms }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingProximity, setEditingProximity] = useState(building.proximity);
  const [adding, setAdding] = useState(false);
  const [rooms, setRooms] = useState(building.rooms);
  useEffect(() => setRooms(building.rooms), [building.rooms]);

  // Re-sync editingProximity from the current prop each time the user
  // enters edit mode. Without this, the useState initial value above
  // only captures proximity at mount — so a refresh-tick reload that
  // pulled in an externally-changed proximity would leave the next
  // edit session's <select> showing the OLD value, and saving would
  // clobber the newer server state.
  function startEditing() {
    setEditingProximity(building.proximity);
    setEditing(true);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleRoomDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = rooms.findIndex(r => r.id === active.id);
    const newIdx = rooms.findIndex(r => r.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(rooms, oldIdx, newIdx);
    setRooms(reordered);
    onReorderRooms(building.id, reordered.map(r => r.id));
  }

  if (editing) return (
    <div className="py-2 pl-2">
      <div className="flex items-center gap-2">
        <InlineEdit value={building.name}
          onSave={v => { onEdit(building.id, v, editingProximity); setEditing(false); }}
          onCancel={() => setEditing(false)} />
        <select
          value={editingProximity}
          onChange={e => setEditingProximity(e.target.value)}
          aria-label="Proximity"
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none"
        >
          {PROXIMITY_OPTIONS.map(p => <option key={p} value={p}>{PROXIMITY_LABEL[p]}</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <div className="border border-neutral-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-neutral-900/50 group">
        <div className="flex items-center gap-1 min-w-0">
          <span className="opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">{dragHandle}</span>
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-2 text-left min-w-0">
            <span className="text-neutral-500 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-medium text-parchment">{building.name}</span>
          <span className="text-xs text-neutral-600 bg-neutral-800 px-1.5 py-0.5 rounded">
            {PROXIMITY_LABEL[building.proximity]}
          </span>
          <span className="text-xs text-neutral-600">{plural(building.rooms.length, 'room')}</span>
          </button>
        </div>
        <div className="flex items-center gap-2 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {open && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors whitespace-nowrap">+ room</button>
          )}
          <button type="button" onClick={startEditing} title="Rename building" aria-label={`Rename building ${building.name}`} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">✎</button>
          <button type="button" onClick={() => onDelete(building.id)} title="Delete building" aria-label={`Delete building ${building.name}`} className="text-xs text-neutral-600 hover:text-warn transition-colors">×</button>
        </div>
      </div>
      {open && (
        <div className="py-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRoomDragEnd}>
            <SortableContext items={rooms.map(r => r.id)} strategy={verticalListSortingStrategy}>
              {rooms.map(r => (
                <SortableRoom key={r.id} room={r}
                  onEdit={onEditRoom} onDelete={onDeleteRoom}
                  onAddUnit={onAddUnit} onReorderUnits={onReorderUnits}
                  onEditUnit={onEditUnit} onDeleteUnit={onDeleteUnit}
                  onAddShelf={onAddShelf} onEditShelf={onEditShelf} onDeleteShelf={onDeleteShelf}
                  onReorderShelves={onReorderShelves} />
              ))}
            </SortableContext>
          </DndContext>
          {adding && (
            <div className="pl-6 py-1.5">
              <InlineInput placeholder="e.g. Living Room, Office…"
                onSave={v => { onAddRoom(building.id, v); setAdding(false); }}
                onCancel={() => setAdding(false)} />
            </div>
          )}
          {!adding && building.rooms.length === 0 && (
            <p className="text-xs text-neutral-700 pl-6 py-2">No rooms yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SortableBuilding({ building, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: building.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className={isDragging ? 'opacity-40' : ''}>
      <BuildingSection building={building} dragHandle={<DragHandle listeners={listeners} />} {...props} />
    </div>
  );
}
