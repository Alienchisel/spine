import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';

function DragHandle({ listeners }) {
  return (
    <button
      type="button"
      {...listeners}
      className="text-neutral-700 hover:text-neutral-400 transition-colors cursor-grab active:cursor-grabbing flex-shrink-0 px-0.5"
      aria-label="Drag to reorder"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
        <path fillRule="evenodd" d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm.75 3.25a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z" clipRule="evenodd" />
      </svg>
    </button>
  );
}

const PROXIMITY_LABEL = { home: 'Home', nearby: 'Nearby', remote: 'Remote' };
const PROXIMITY_OPTIONS = ['home', 'nearby', 'remote'];

function InlineInput({ placeholder, onSave, onCancel }) {
  const [val, setVal] = useState('');
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);
  function handleKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); if (val.trim()) onSave(val.trim()); }
    if (e.key === 'Escape') onCancel();
  }
  return (
    <form onSubmit={e => { e.preventDefault(); if (val.trim()) onSave(val.trim()); }} className="flex items-center gap-1.5">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 w-36"
      />
      <button type="submit" disabled={!val.trim()} className="text-xs text-oak hover:text-leather disabled:opacity-40 transition-colors">add</button>
      <button type="button" onClick={onCancel} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">cancel</button>
    </form>
  );
}

function InlineEdit({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  function handleKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); if (val.trim()) onSave(val.trim()); }
    if (e.key === 'Escape') onCancel();
  }
  return (
    <form onSubmit={e => { e.preventDefault(); if (val.trim()) onSave(val.trim()); }} className="flex items-center gap-1.5">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKey}
        className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-oak/50 w-36"
      />
      <button type="submit" disabled={!val.trim()} className="text-xs text-oak hover:text-leather disabled:opacity-40 transition-colors">save</button>
      <button type="button" onClick={onCancel} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">cancel</button>
    </form>
  );
}

function ShelfRow({ shelf, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  if (editing) return (
    <div className="flex items-center gap-2 py-1.5 pl-16">
      <InlineEdit value={shelf.label} onSave={v => { onEdit(shelf.id, v); setEditing(false); }} onCancel={() => setEditing(false)} />
    </div>
  );
  return (
    <div className="flex items-center justify-between py-1.5 pl-16 pr-2 group">
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-400">{shelf.label}</span>
        {shelf.book_count > 0 && (
          <span className="text-xs text-neutral-600">· {shelf.book_count} {shelf.book_count === 1 ? 'book' : 'books'}</span>
        )}
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setEditing(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">✎</button>
        <button onClick={() => onDelete(shelf.id)} className="text-xs text-neutral-600 hover:text-warn transition-colors">×</button>
      </div>
    </div>
  );
}

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
            <ShelfRow key={s.id} shelf={s}
              onEdit={onEditShelf} onDelete={onDeleteShelf} />
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

function SortableUnit({ unit, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: unit.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className={isDragging ? 'opacity-40' : ''}>
      <UnitSection unit={unit} dragHandle={<DragHandle listeners={listeners} />} {...props} />
    </div>
  );
}

function RoomSection({ room, dragHandle, onEdit, onDelete, onAddUnit, onReorderUnits, onEditUnit, onDeleteUnit, onAddShelf, onEditShelf, onDeleteShelf }) {
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
                  onAddShelf={onAddShelf} onEditShelf={onEditShelf} onDeleteShelf={onDeleteShelf} />
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

function SortableBuilding({ building, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: building.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className={isDragging ? 'opacity-40' : ''}>
      <BuildingSection building={building} dragHandle={<DragHandle listeners={listeners} />} {...props} />
    </div>
  );
}

function SortableRoom({ room, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: room.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} className={isDragging ? 'opacity-40' : ''}>
      <RoomSection room={room} dragHandle={<DragHandle listeners={listeners} />} {...props} />
    </div>
  );
}

function BuildingSection({ building, dragHandle, onEdit, onDelete, onAddRoom, onEditRoom, onDeleteRoom,
  onAddUnit, onReorderUnits, onEditUnit, onDeleteUnit, onAddShelf, onEditShelf, onDeleteShelf,
  onReorderRooms }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingProximity, setEditingProximity] = useState(building.proximity);
  const [adding, setAdding] = useState(false);
  const [rooms, setRooms] = useState(building.rooms);
  useEffect(() => setRooms(building.rooms), [building.rooms]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleRoomDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = rooms.findIndex(r => r.id === active.id);
    const newIdx = rooms.findIndex(r => r.id === over.id);
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
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">{dragHandle}</span>
          <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left min-w-0">
            <span className="text-neutral-500 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-medium text-parchment">{building.name}</span>
          <span className="text-xs text-neutral-600 bg-neutral-800 px-1.5 py-0.5 rounded">
            {PROXIMITY_LABEL[building.proximity]}
          </span>
          <span className="text-xs text-neutral-600">{building.rooms.length} {building.rooms.length === 1 ? 'room' : 'rooms'}</span>
          </button>
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {open && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors whitespace-nowrap">+ room</button>
          )}
          <button onClick={() => setEditing(true)} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">✎</button>
          <button onClick={() => onDelete(building.id)} className="text-xs text-neutral-600 hover:text-warn transition-colors">×</button>
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
                  onAddShelf={onAddShelf} onEditShelf={onEditShelf} onDeleteShelf={onDeleteShelf} />
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

export default function ShelfManager() {
  const [tree, setTree] = useState([]);
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [newBuildingName, setNewBuildingName] = useState('');
  const [newBuildingProximity, setNewBuildingProximity] = useState('home');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleBuildingDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = tree.findIndex(b => b.id === active.id);
    const newIdx = tree.findIndex(b => b.id === over.id);
    const reordered = arrayMove(tree, oldIdx, newIdx);
    setTree(reordered);
    api.reorderBuildings(reordered.map(b => b.id));
  }

  async function reload() {
    const t = await api.getShelfTree();
    setTree(t);
  }

  useEffect(() => { reload(); }, []);

  async function addBuilding() {
    if (!newBuildingName.trim()) return;
    await api.createBuilding({ name: newBuildingName.trim(), proximity: newBuildingProximity });
    setNewBuildingName('');
    setNewBuildingProximity('home');
    setAddingBuilding(false);
    reload();
  }

  async function editBuilding(id, name, proximity) {
    const b = tree.find(x => x.id === id);
    await api.updateBuilding(id, { name, proximity, notes: b?.notes, order_index: b?.order_index });
    reload();
  }

  async function deleteBuilding(id) {
    if (!confirm('Delete this building and all its rooms, units, and shelves?')) return;
    await api.deleteBuilding(id);
    reload();
  }

  async function addRoom(buildingId, name) {
    await api.createRoom({ building_id: buildingId, name });
    reload();
  }

  async function reorderRooms(buildingId, ids) {
    await api.reorderRooms(buildingId, ids);
  }

  async function editRoom(id, name) {
    const r = tree.flatMap(b => b.rooms).find(x => x.id === id);
    await api.updateRoom(id, { name, order_index: r?.order_index });
    reload();
  }

  async function deleteRoom(id) {
    if (!confirm('Delete this room and all its units and shelves?')) return;
    await api.deleteRoom(id);
    reload();
  }

  async function reorderUnits(roomId, ids) {
    await api.reorderUnits(roomId, ids);
  }

  async function addUnit(roomId, name) {
    await api.createUnit({ room_id: roomId, name });
    reload();
  }

  async function editUnit(id, name) {
    const u = tree.flatMap(b => b.rooms).flatMap(r => r.units).find(x => x.id === id);
    await api.updateUnit(id, { name, order_index: u?.order_index });
    reload();
  }

  async function deleteUnit(id) {
    if (!confirm('Delete this unit and all its shelves?')) return;
    await api.deleteUnit(id);
    reload();
  }

  async function addShelf(unitId, label) {
    await api.createShelf({ unit_id: unitId, label });
    reload();
  }

  async function editShelf(id, label) {
    const s = tree.flatMap(b => b.rooms).flatMap(r => r.units).flatMap(u => u.shelves).find(x => x.id === id);
    await api.updateShelf(id, { label, order_index: s?.order_index });
    reload();
  }

  async function deleteShelf(id) {
    if (!confirm('Delete this shelf? Books assigned here will lose their location.')) return;
    await api.deleteShelf(id);
    reload();
  }

  return (
    <div className="max-w-2xl">
      <Link to="/shelf-view" className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        ← Shelf view
      </Link>
      <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase mb-8">Shelves</h1>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleBuildingDragEnd}>
      <SortableContext items={tree.map(b => b.id)} strategy={verticalListSortingStrategy}>
      <div className="space-y-3">
        {tree.map(b => (
          <SortableBuilding key={b.id} building={b}
            onEdit={editBuilding} onDelete={deleteBuilding}
            onAddRoom={addRoom} onEditRoom={editRoom} onDeleteRoom={deleteRoom} onReorderRooms={reorderRooms}
            onAddUnit={addUnit} onEditUnit={editUnit} onDeleteUnit={deleteUnit} onReorderUnits={reorderUnits}
            onAddShelf={addShelf} onEditShelf={editShelf} onDeleteShelf={deleteShelf} />
        ))}

        {addingBuilding ? (
          <div className="border border-neutral-800 rounded-lg p-4 space-y-3">
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">New building</p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newBuildingName}
                onChange={e => setNewBuildingName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addBuilding(); if (e.key === 'Escape') setAddingBuilding(false); }}
                placeholder="e.g. Home, Office, Storage…"
                className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50"
              />
              <select
                value={newBuildingProximity}
                onChange={e => setNewBuildingProximity(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-300 focus:outline-none"
              >
                {PROXIMITY_OPTIONS.map(p => <option key={p} value={p}>{PROXIMITY_LABEL[p]}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={addBuilding} disabled={!newBuildingName.trim()}
                className="text-xs bg-oak hover:bg-leather disabled:opacity-40 text-neutral-950 font-semibold px-3 py-1.5 rounded transition-colors">
                Add building
              </button>
              <button onClick={() => setAddingBuilding(false)}
                className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingBuilding(true)}
            className="text-sm text-neutral-600 hover:text-neutral-300 transition-colors"
          >
            + Add building
          </button>
        )}
      </div>
      </SortableContext>
      </DndContext>
    </div>
  );
}
