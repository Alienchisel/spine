import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

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
        <span className="text-xs text-neutral-400">Shelf {shelf.label}</span>
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

function UnitSection({ unit, onEdit, onDelete, onAddShelf, onEditShelf, onDeleteShelf }) {
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
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-left min-w-0">
          <span className="text-neutral-600 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
          <span className="text-xs text-neutral-300">{unit.name}</span>
          <span className="text-xs text-neutral-600 ml-1">{unit.shelf_count} {unit.shelf_count === 1 ? 'shelf' : 'shelves'}</span>
        </button>
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

function RoomSection({ room, onEdit, onDelete, onAddUnit, onEditUnit, onDeleteUnit, onAddShelf, onEditShelf, onDeleteShelf }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  if (editing) return (
    <div className="py-1.5 pl-6">
      <InlineEdit value={room.name} onSave={v => { onEdit(room.id, v); setEditing(false); }} onCancel={() => setEditing(false)} />
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between py-1.5 pl-6 pr-2 group">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-left min-w-0">
          <span className="text-neutral-600 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
          <span className="text-xs text-neutral-200">{room.name}</span>
          <span className="text-xs text-neutral-600 ml-1">{room.unit_count} {room.unit_count === 1 ? 'unit' : 'units'}</span>
        </button>
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
          {room.units.map(u => (
            <UnitSection key={u.id} unit={u}
              onEdit={onEditUnit} onDelete={onDeleteUnit}
              onAddShelf={onAddShelf} onEditShelf={onEditShelf} onDeleteShelf={onDeleteShelf} />
          ))}
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

function BuildingSection({ building, onEdit, onDelete, onAddRoom, onEditRoom, onDeleteRoom,
  onAddUnit, onEditUnit, onDeleteUnit, onAddShelf, onEditShelf, onDeleteShelf }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingProximity, setEditingProximity] = useState(building.proximity);
  const [adding, setAdding] = useState(false);

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
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left min-w-0">
          <span className="text-neutral-500 text-xs w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-medium text-parchment">{building.name}</span>
          <span className="text-xs text-neutral-600 bg-neutral-800 px-1.5 py-0.5 rounded">
            {PROXIMITY_LABEL[building.proximity]}
          </span>
          <span className="text-xs text-neutral-600">{building.room_count} {building.room_count === 1 ? 'room' : 'rooms'}</span>
        </button>
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
          {building.rooms.map(r => (
            <RoomSection key={r.id} room={r}
              onEdit={onEditRoom} onDelete={onDeleteRoom}
              onAddUnit={onAddUnit} onEditUnit={onEditUnit} onDeleteUnit={onDeleteUnit}
              onAddShelf={onAddShelf} onEditShelf={onEditShelf} onDeleteShelf={onDeleteShelf} />
          ))}
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

      <div className="space-y-3">
        {tree.map(b => (
          <BuildingSection key={b.id} building={b}
            onEdit={editBuilding} onDelete={deleteBuilding}
            onAddRoom={addRoom} onEditRoom={editRoom} onDeleteRoom={deleteRoom}
            onAddUnit={addUnit} onEditUnit={editUnit} onDeleteUnit={deleteUnit}
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
    </div>
  );
}
