import { useState, useEffect } from 'react';

const PROXIMITY_LABEL = { home: 'Home', nearby: 'Nearby', remote: 'Remote' };

function findSelections(shelfId, tree) {
  for (const b of tree) {
    for (const r of b.rooms) {
      for (const u of r.units) {
        for (const s of u.shelves) {
          if (s.id === shelfId) return { buildingId: b.id, roomId: r.id, unitId: u.id, shelfId: s.id };
        }
      }
    }
  }
  return { buildingId: null, roomId: null, unitId: null, shelfId: null };
}

export default function ShelfPicker({ shelfId, onChange, tree }) {
  const [sel, setSel] = useState(() =>
    shelfId && tree.length ? findSelections(shelfId, tree) : { buildingId: null, roomId: null, unitId: null, shelfId: null }
  );

  useEffect(() => {
    setSel(shelfId && tree.length ? findSelections(shelfId, tree) : { buildingId: null, roomId: null, unitId: null, shelfId: null });
  }, [shelfId, tree]);

  const select = 'w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2.5 text-sm text-white focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors duration-150';

  const rooms   = tree.find(b => b.id === sel.buildingId)?.rooms   ?? [];
  const units   = rooms.find(r => r.id === sel.roomId)?.units       ?? [];
  const shelves = units.find(u => u.id === sel.unitId)?.shelves     ?? [];

  function setBuilding(bid) {
    const id = bid ? Number(bid) : null;
    setSel({ buildingId: id, roomId: null, unitId: null, shelfId: null });
    onChange(null);
  }

  function setRoom(rid) {
    const id = rid ? Number(rid) : null;
    setSel(s => ({ ...s, roomId: id, unitId: null, shelfId: null }));
    onChange(null);
  }

  function setUnit(uid) {
    const id = uid ? Number(uid) : null;
    setSel(s => ({ ...s, unitId: id, shelfId: null }));
    onChange(null);
  }

  function setShelf(sid) {
    const id = sid ? Number(sid) : null;
    setSel(s => ({ ...s, shelfId: id }));
    onChange(id);
  }

  function clear() {
    setSel({ buildingId: null, roomId: null, unitId: null, shelfId: null });
    onChange(null);
  }

  if (!tree.length) return null;

  return (
    <div className="space-y-2.5 pl-4 border-l-2 border-neutral-800">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Shelf location</p>

      <div>
        <label className="block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider">Building</label>
        <select className={select} value={sel.buildingId ?? ''} onChange={e => setBuilding(e.target.value)}>
          <option value="">—</option>
          {tree.map(b => (
            <option key={b.id} value={b.id}>{b.name} ({PROXIMITY_LABEL[b.proximity]})</option>
          ))}
        </select>
      </div>

      {sel.buildingId && (
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider">Room</label>
          <select className={select} value={sel.roomId ?? ''} onChange={e => setRoom(e.target.value)}>
            <option value="">—</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      )}

      {sel.roomId && (
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider">Unit</label>
          <select className={select} value={sel.unitId ?? ''} onChange={e => setUnit(e.target.value)}>
            <option value="">—</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}

      {sel.unitId && (
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider">Shelf</label>
          <select className={select} value={sel.shelfId ?? ''} onChange={e => setShelf(e.target.value)}>
            <option value="">—</option>
            {shelves.map(s => <option key={s.id} value={s.id}>Shelf {s.label}</option>)}
          </select>
        </div>
      )}

      {sel.shelfId && (
        <button type="button" onClick={clear} className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors">
          Clear location
        </button>
      )}
    </div>
  );
}
