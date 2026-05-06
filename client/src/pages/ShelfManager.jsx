import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { api } from '../api.js';
import SortableBuilding from '../components/shelfManager/BuildingSection.jsx';
import { PROXIMITY_LABEL, PROXIMITY_OPTIONS } from '../components/shelfManager/proximity.js';
import { useConfirm } from '../components/ConfirmModal.jsx';

export default function ShelfManager() {
  const [tree, setTree] = useState([]);
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [newBuildingName, setNewBuildingName] = useState('');
  const [newBuildingProximity, setNewBuildingProximity] = useState('home');
  const [error, setError] = useState(null);
  const confirm = useConfirm();
  // Stale-response guard for reload(). Every mutation kicks off a reload,
  // and a fast user can interleave several writes whose reload responses
  // race. Without this, an early reload's snapshot can land last and
  // overwrite a later reload's already-applied tree (e.g. "the room I just
  // added vanished"). Each reload captures its gen and drops setTree if a
  // newer reload has bumped the ref.
  const treeGenRef = useRef(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleBuildingDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = tree.findIndex(b => b.id === active.id);
    const newIdx = tree.findIndex(b => b.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(tree, oldIdx, newIdx);
    setTree(reordered);
    setError(null);
    api.reorderBuildings(reordered.map(b => b.id)).catch(() => {
      setError('Failed to save reorder.');
      reload();  // refetches the canonical tree (may overwrite error if reload also fails)
    });
  }

  async function reload() {
    const gen = ++treeGenRef.current;
    try {
      const t = await api.getShelfTree();
      if (gen !== treeGenRef.current) return;
      setTree(t);
    } catch {
      if (gen !== treeGenRef.current) return;
      setError('Failed to load shelves.');
    }
  }

  useEffect(() => { reload(); }, []);

  async function addBuilding() {
    if (!newBuildingName.trim()) return;
    setError(null);
    try {
      await api.createBuilding({ name: newBuildingName.trim(), proximity: newBuildingProximity });
      setNewBuildingName('');
      setNewBuildingProximity('home');
      setAddingBuilding(false);
      reload();
    } catch {
      setError('Failed to add building.');
    }
  }

  async function editBuilding(id, name, proximity) {
    const b = tree.find(x => x.id === id);
    setError(null);
    try {
      await api.updateBuilding(id, { name, proximity, notes: b?.notes, order_index: b?.order_index });
      reload();
    } catch {
      setError('Failed to update building.');
    }
  }

  async function deleteBuilding(id) {
    if (!await confirm('Delete this building and all its rooms, units, and shelves?')) return;
    setError(null);
    try {
      await api.deleteBuilding(id);
      reload();
    } catch {
      setError('Failed to delete building.');
    }
  }

  async function addRoom(buildingId, name) {
    setError(null);
    try {
      await api.createRoom({ building_id: buildingId, name });
      reload();
    } catch {
      setError('Failed to add room.');
    }
  }

  async function reorderRooms(buildingId, ids) {
    setError(null);
    try {
      await api.reorderRooms(buildingId, ids);
    } catch {
      setError('Failed to save reorder.');
      reload();
    }
  }

  async function editRoom(id, name) {
    const r = tree.flatMap(b => b.rooms).find(x => x.id === id);
    setError(null);
    try {
      await api.updateRoom(id, { name, order_index: r?.order_index });
      reload();
    } catch {
      setError('Failed to update room.');
    }
  }

  async function deleteRoom(id) {
    if (!await confirm('Delete this room and all its units and shelves?')) return;
    setError(null);
    try {
      await api.deleteRoom(id);
      reload();
    } catch {
      setError('Failed to delete room.');
    }
  }

  async function reorderUnits(roomId, ids) {
    setError(null);
    try {
      await api.reorderUnits(roomId, ids);
    } catch {
      setError('Failed to save reorder.');
      reload();
    }
  }

  async function addUnit(roomId, name) {
    setError(null);
    try {
      await api.createUnit({ room_id: roomId, name });
      reload();
    } catch {
      setError('Failed to add unit.');
    }
  }

  async function editUnit(id, name) {
    const u = tree.flatMap(b => b.rooms).flatMap(r => r.units).find(x => x.id === id);
    setError(null);
    try {
      await api.updateUnit(id, { name, order_index: u?.order_index });
      reload();
    } catch {
      setError('Failed to update unit.');
    }
  }

  async function deleteUnit(id) {
    if (!await confirm('Delete this unit and all its shelves?')) return;
    setError(null);
    try {
      await api.deleteUnit(id);
      reload();
    } catch {
      setError('Failed to delete unit.');
    }
  }

  async function reorderShelves(unitId, ids) {
    setError(null);
    try {
      await api.reorderShelves(unitId, ids);
    } catch {
      setError('Failed to save reorder.');
      reload();
    }
  }

  async function addShelf(unitId, label) {
    setError(null);
    try {
      await api.createShelf({ unit_id: unitId, label });
      reload();
    } catch {
      setError('Failed to add shelf.');
    }
  }

  async function editShelf(id, label) {
    const s = tree.flatMap(b => b.rooms).flatMap(r => r.units).flatMap(u => u.shelves).find(x => x.id === id);
    setError(null);
    try {
      await api.updateShelf(id, { label, order_index: s?.order_index });
      reload();
    } catch {
      setError('Failed to update shelf.');
    }
  }

  async function deleteShelf(id) {
    if (!await confirm('Delete this shelf? Books assigned here will lose their location.')) return;
    setError(null);
    try {
      await api.deleteShelf(id);
      reload();
    } catch {
      setError('Failed to delete shelf.');
    }
  }

  return (
    <div className="max-w-2xl">
      <Link to="/shelf-view" className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        ← Shelf view
      </Link>
      <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase mb-8">Shelves</h1>

      {error && (
        <div className="mb-4 flex items-center justify-between bg-warn/10 border border-warn/30 rounded px-3 py-2">
          <p className="text-xs text-warn">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-warn/60 hover:text-warn ml-4">×</button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleBuildingDragEnd}>
      <SortableContext items={tree.map(b => b.id)} strategy={verticalListSortingStrategy}>
      <div className="space-y-3">
        {tree.map(b => (
          <SortableBuilding key={b.id} building={b}
            onEdit={editBuilding} onDelete={deleteBuilding}
            onAddRoom={addRoom} onEditRoom={editRoom} onDeleteRoom={deleteRoom} onReorderRooms={reorderRooms}
            onAddUnit={addUnit} onEditUnit={editUnit} onDeleteUnit={deleteUnit} onReorderUnits={reorderUnits}
            onAddShelf={addShelf} onEditShelf={editShelf} onDeleteShelf={deleteShelf} onReorderShelves={reorderShelves} />
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
