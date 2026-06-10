import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable';
import { api } from '../api.js';
import { plural } from '../utils.js';
import SortableBuilding from '../components/shelfManager/BuildingSection.jsx';
import { PROXIMITY_LABEL, PROXIMITY_OPTIONS } from '../components/shelfManager/proximity.js';
import { useConfirm } from '../components/ConfirmModal.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import PageHeading from '../components/PageHeading.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';

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
  const guard = useStaleGuard();
  // Per-namespace reorder seq counters. Each drag's .catch checks "is my
  // seq still the latest?" — if not, the drag has been superseded and
  // the catch returns silently. Was previously a single shared counter,
  // but building / room / unit / shelf reorders target independent server
  // resources: a later room drag bumping the counter would silently
  // suppress an earlier *building* reorder's failure banner, leaving the
  // tree desynced from the server with no surfaced error. Per-namespace
  // counters keep each reorder gated only by its own sibling reorders.
  // Mirrors the seq guard in Readlist / ListDetail / ShelfView, scoped.
  const reorderSeqRef = useRef({ building: 0, room: 0, unit: 0, shelf: 0 });
  // Tracks ids whose delete is in flight, per kind. The confirm modal
  // cancels overlapping confirms, but a re-click *after* confirming —
  // while the API call is pending and reload() hasn't yet refreshed the
  // tree — fires a duplicate delete that 404s and surfaces a stale
  // "Failed to delete …" banner on a row that did delete. Four refs
  // because building/room/unit/shelf id namespaces are independent.
  // Mirrors the pattern in ReadsSection / Diary / Lists.
  const deletingBuildingIdsRef = useRef(new Set());
  const deletingRoomIdsRef     = useRef(new Set());
  const deletingUnitIdsRef     = useRef(new Set());
  const deletingShelfIdsRef    = useRef(new Set());
  // Per-kind in-flight guards for inline-edit submits. Without these a
  // keyboard-repeat Enter or a fast double-tap on Save fires the PUT
  // twice and queues two reload() chases. Sets (per id) rather than
  // booleans because the user can edit different rows concurrently —
  // mirrors the deletingXxxIdsRef shape.
  const editingBuildingIdsRef = useRef(new Set());
  const editingRoomIdsRef     = useRef(new Set());
  const editingUnitIdsRef     = useRef(new Set());
  const editingShelfIdsRef    = useRef(new Set());
  // Synchronous in-flight guards for the add* handlers. Same-tick double
  // submit (Enter-key autorepeat in the name field) would otherwise pass
  // any state-only `if (creating) return` and create two identical rows.
  // Per-kind because a user could legitimately expand and submit different
  // forms concurrently.
  const addingBuildingRef = useRef(false);
  const addingRoomRef     = useRef(false);
  const addingUnitRef     = useRef(false);
  const addingShelfRef    = useRef(false);
  const refreshTick = useRefreshTick();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleBuildingDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = tree.findIndex(b => b.id === active.id);
    const newIdx = tree.findIndex(b => b.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(tree, oldIdx, newIdx);
    setTree(reordered);
    setError(null);
    const seq = ++reorderSeqRef.current.building;
    api.reorderBuildings(reordered.map(b => b.id)).catch(() => {
      if (seq !== reorderSeqRef.current.building) return;
      setError('Failed to save reorder.');
      reload();  // refetches the canonical tree (may overwrite error if reload also fails)
    });
  }

  async function reload() {
    const epoch = guard.next();
    try {
      const t = await api.getShelfTree();
      if (!guard.isFresh(epoch)) return;
      setTree(t);
      setError(null);
    } catch {
      if (!guard.isFresh(epoch)) return;
      setError('Failed to load shelves.');
    }
  }

  useEffect(() => { reload(); }, [refreshTick]);

  async function addBuilding() {
    if (addingBuildingRef.current) return;
    if (!newBuildingName.trim()) return;
    addingBuildingRef.current = true;
    setError(null);
    try {
      await api.createBuilding({ name: newBuildingName.trim(), proximity: newBuildingProximity });
      setNewBuildingName('');
      setNewBuildingProximity('home');
      setAddingBuilding(false);
      reload();
    } catch {
      setError('Failed to add building.');
    } finally {
      addingBuildingRef.current = false;
    }
  }

  async function editBuilding(id, name, proximity) {
    if (editingBuildingIdsRef.current.has(id)) return;
    editingBuildingIdsRef.current.add(id);
    const b = tree.find(x => x.id === id);
    setError(null);
    try {
      await api.updateBuilding(id, { name, proximity, notes: b?.notes, order_index: b?.order_index });
      reload();
    } catch {
      setError('Failed to update building.');
    } finally {
      editingBuildingIdsRef.current.delete(id);
    }
  }

  // Roll-up book counts for the four delete-confirm sites. The /tree
  // endpoint already returns book_count at every level (owned + not
  // archived) so the user sees how many books will be unshelved before
  // confirming a building / room / unit / shelf delete. ON DELETE
  // CASCADE handles the hierarchy; ON DELETE SET NULL on the book
  // location FKs means the books survive — only their location columns
  // null out — so "unshelved" is the right word.
  function buildingBookCount(id) {
    return tree.find(b => b.id === id)?.book_count ?? 0;
  }
  function roomBookCount(id) {
    for (const b of tree) for (const r of b.rooms || []) if (r.id === id) return r.book_count ?? 0;
    return 0;
  }
  function unitBookCount(id) {
    for (const b of tree) for (const r of b.rooms || []) for (const u of r.units || []) if (u.id === id) return u.book_count ?? 0;
    return 0;
  }
  function shelfBookCount(id) {
    for (const b of tree) for (const r of b.rooms || []) for (const u of r.units || []) for (const s of u.shelves || []) if (s.id === id) return s.book_count ?? 0;
    return 0;
  }
  function suffixBooks(n) {
    return n > 0 ? ` ${plural(n, 'book')} will be unshelved.` : '';
  }

  async function deleteBuilding(id) {
    if (deletingBuildingIdsRef.current.has(id)) return;
    if (!await confirm(`Delete this building and all its rooms, units, and shelves?${suffixBooks(buildingBookCount(id))}`)) return;
    if (deletingBuildingIdsRef.current.has(id)) return;
    deletingBuildingIdsRef.current.add(id);
    setError(null);
    try {
      await api.deleteBuilding(id);
      reload();
    } catch {
      setError('Failed to delete building.');
    } finally {
      deletingBuildingIdsRef.current.delete(id);
    }
  }

  async function addRoom(buildingId, name) {
    if (addingRoomRef.current) return;
    addingRoomRef.current = true;
    setError(null);
    try {
      await api.createRoom({ building_id: buildingId, name });
      reload();
    } catch {
      setError('Failed to add room.');
    } finally {
      addingRoomRef.current = false;
    }
  }

  async function reorderRooms(buildingId, ids) {
    setError(null);
    const seq = ++reorderSeqRef.current.room;
    try {
      await api.reorderRooms(buildingId, ids);
    } catch {
      if (seq !== reorderSeqRef.current.room) return;
      setError('Failed to save reorder.');
      reload();
    }
  }

  async function editRoom(id, name) {
    if (editingRoomIdsRef.current.has(id)) return;
    editingRoomIdsRef.current.add(id);
    const r = tree.flatMap(b => b.rooms).find(x => x.id === id);
    setError(null);
    try {
      await api.updateRoom(id, { name, order_index: r?.order_index });
      reload();
    } catch {
      setError('Failed to update room.');
    } finally {
      editingRoomIdsRef.current.delete(id);
    }
  }

  async function deleteRoom(id) {
    if (deletingRoomIdsRef.current.has(id)) return;
    if (!await confirm(`Delete this room and all its units and shelves?${suffixBooks(roomBookCount(id))}`)) return;
    if (deletingRoomIdsRef.current.has(id)) return;
    deletingRoomIdsRef.current.add(id);
    setError(null);
    try {
      await api.deleteRoom(id);
      reload();
    } catch {
      setError('Failed to delete room.');
    } finally {
      deletingRoomIdsRef.current.delete(id);
    }
  }

  async function reorderUnits(roomId, ids) {
    setError(null);
    const seq = ++reorderSeqRef.current.unit;
    try {
      await api.reorderUnits(roomId, ids);
    } catch {
      if (seq !== reorderSeqRef.current.unit) return;
      setError('Failed to save reorder.');
      reload();
    }
  }

  async function addUnit(roomId, name) {
    if (addingUnitRef.current) return;
    addingUnitRef.current = true;
    setError(null);
    try {
      await api.createUnit({ room_id: roomId, name });
      reload();
    } catch {
      setError('Failed to add unit.');
    } finally {
      addingUnitRef.current = false;
    }
  }

  async function editUnit(id, name) {
    if (editingUnitIdsRef.current.has(id)) return;
    editingUnitIdsRef.current.add(id);
    const u = tree.flatMap(b => b.rooms).flatMap(r => r.units).find(x => x.id === id);
    setError(null);
    try {
      await api.updateUnit(id, { name, order_index: u?.order_index });
      reload();
    } catch {
      setError('Failed to update unit.');
    } finally {
      editingUnitIdsRef.current.delete(id);
    }
  }

  async function deleteUnit(id) {
    if (deletingUnitIdsRef.current.has(id)) return;
    if (!await confirm(`Delete this unit and all its shelves?${suffixBooks(unitBookCount(id))}`)) return;
    if (deletingUnitIdsRef.current.has(id)) return;
    deletingUnitIdsRef.current.add(id);
    setError(null);
    try {
      await api.deleteUnit(id);
      reload();
    } catch {
      setError('Failed to delete unit.');
    } finally {
      deletingUnitIdsRef.current.delete(id);
    }
  }

  async function reorderShelves(unitId, ids) {
    setError(null);
    const seq = ++reorderSeqRef.current.shelf;
    try {
      await api.reorderShelves(unitId, ids);
    } catch {
      if (seq !== reorderSeqRef.current.shelf) return;
      setError('Failed to save reorder.');
      reload();
    }
  }

  async function addShelf(unitId, label) {
    if (addingShelfRef.current) return;
    addingShelfRef.current = true;
    setError(null);
    try {
      await api.createShelf({ unit_id: unitId, label });
      reload();
    } catch {
      setError('Failed to add shelf.');
    } finally {
      addingShelfRef.current = false;
    }
  }

  async function editShelf(id, label) {
    if (editingShelfIdsRef.current.has(id)) return;
    editingShelfIdsRef.current.add(id);
    const s = tree.flatMap(b => b.rooms).flatMap(r => r.units).flatMap(u => u.shelves).find(x => x.id === id);
    setError(null);
    try {
      await api.updateShelf(id, { label, order_index: s?.order_index });
      reload();
    } catch {
      setError('Failed to update shelf.');
    } finally {
      editingShelfIdsRef.current.delete(id);
    }
  }

  async function deleteShelf(id) {
    if (deletingShelfIdsRef.current.has(id)) return;
    if (!await confirm(`Delete this shelf?${suffixBooks(shelfBookCount(id))}`)) return;
    if (deletingShelfIdsRef.current.has(id)) return;
    deletingShelfIdsRef.current.add(id);
    setError(null);
    try {
      await api.deleteShelf(id);
      reload();
    } catch {
      setError('Failed to delete shelf.');
    } finally {
      deletingShelfIdsRef.current.delete(id);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link to="/shelf-view" className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        ← Shelf view
      </Link>
      <div className="mb-8"><PageHeading>Shelves</PageHeading></div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4" />

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
                aria-label="New building name"
                className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors"
              />
              <select
                value={newBuildingProximity}
                onChange={e => setNewBuildingProximity(e.target.value)}
                aria-label="New building proximity"
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors"
              >
                {PROXIMITY_OPTIONS.map(p => <option key={p} value={p}>{PROXIMITY_LABEL[p]}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={addBuilding} disabled={!newBuildingName.trim()}
                className="text-xs bg-oak hover:bg-leather disabled:opacity-60 text-neutral-950 font-semibold px-3 py-1.5 rounded transition-colors">
                Add building
              </button>
              <button type="button" onClick={() => setAddingBuilding(false)}
                className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
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
