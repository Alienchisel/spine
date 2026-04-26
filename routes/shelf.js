import express from 'express';
import db from '../db.js';

const router = express.Router();

function t(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

const VALID_PROXIMITY = ['home', 'nearby', 'remote'];

// ── Full tree (for pickers and manager) ───────────────────────────────────

router.get('/tree', (_req, res) => {
  const buildings = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM books WHERE building_id = b.id)
      + (SELECT COUNT(*) FROM books WHERE room_id IN (SELECT id FROM rooms WHERE building_id = b.id))
      + (SELECT COUNT(*) FROM books WHERE unit_id IN (SELECT u.id FROM units u JOIN rooms r ON u.room_id = r.id WHERE r.building_id = b.id))
      + (SELECT COUNT(*) FROM books bk JOIN shelves s ON bk.shelf_id = s.id JOIN units u ON s.unit_id = u.id JOIN rooms r ON u.room_id = r.id WHERE r.building_id = b.id)
      AS book_count
    FROM buildings b ORDER BY b.order_index, b.name
  `).all();
  const rooms     = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM books WHERE room_id = r.id)
      + (SELECT COUNT(*) FROM books WHERE unit_id IN (SELECT id FROM units WHERE room_id = r.id))
      + (SELECT COUNT(*) FROM books b JOIN shelves s ON b.shelf_id = s.id JOIN units u ON s.unit_id = u.id WHERE u.room_id = r.id)
      AS book_count
    FROM rooms r ORDER BY r.order_index, r.name
  `).all();
  const units     = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM books WHERE unit_id = u.id)
      + (SELECT COUNT(*) FROM books WHERE shelf_id IN (SELECT id FROM shelves WHERE unit_id = u.id))
      AS book_count
    FROM units u ORDER BY u.order_index, u.name
  `).all();
  const shelves   = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM books WHERE shelf_id = s.id) AS book_count
    FROM shelves s ORDER BY s.order_index, s.label
  `).all();
  const tree = buildings.map(b => ({
    ...b,
    rooms: rooms.filter(r => r.building_id === b.id).map(r => ({
      ...r,
      units: units.filter(u => u.room_id === r.id).map(u => ({
        ...u,
        shelves: shelves.filter(s => s.unit_id === u.id),
      })),
    })),
  }));
  res.json(tree);
});

// ── Buildings ──────────────────────────────────────────────────────────────

router.get('/buildings', (_req, res) => {
  const buildings = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM rooms WHERE building_id = b.id) AS room_count,
      (SELECT COUNT(*) FROM books bk
        JOIN shelves s ON bk.shelf_id = s.id
        JOIN units u ON s.unit_id = u.id
        JOIN rooms r ON u.room_id = r.id
        WHERE r.building_id = b.id) AS book_count
    FROM buildings b
    ORDER BY b.order_index, b.name
  `).all();
  res.json(buildings);
});

router.post('/buildings', (req, res) => {
  const { name, proximity, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (proximity && !VALID_PROXIMITY.includes(proximity)) return res.status(400).json({ error: 'Invalid proximity' });
  const max = db.prepare('SELECT MAX(order_index) AS m FROM buildings').get();
  const result = db.prepare(`
    INSERT INTO buildings (name, proximity, notes, order_index)
    VALUES (?, ?, ?, ?)
  `).run(t(name), proximity || 'home', t(notes), (max.m ?? -1) + 1);
  res.status(201).json(db.prepare('SELECT * FROM buildings WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/buildings/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(id);
  if (!building) return res.status(404).json({ error: 'Not found' });
  res.json(building);
});

router.put('/buildings/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const { name, proximity, notes, order_index } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (proximity && !VALID_PROXIMITY.includes(proximity)) return res.status(400).json({ error: 'Invalid proximity' });
  const existing = db.prepare('SELECT * FROM buildings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE buildings SET name = ?, proximity = ?, notes = ?, order_index = ? WHERE id = ?
  `).run(t(name), proximity || existing.proximity, t(notes), order_index ?? existing.order_index, id);
  res.json(db.prepare('SELECT * FROM buildings WHERE id = ?').get(id));
});

router.delete('/buildings/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  if (!db.prepare('SELECT id FROM buildings WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM buildings WHERE id = ?').run(id);
  res.status(204).send();
});

// ── Rooms ──────────────────────────────────────────────────────────────────

router.get('/buildings/:id/rooms', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const rooms = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM units WHERE room_id = r.id) AS unit_count,
      (SELECT COUNT(*) FROM books bk
        JOIN shelves s ON bk.shelf_id = s.id
        JOIN units u ON s.unit_id = u.id
        WHERE u.room_id = r.id) AS book_count
    FROM rooms r
    WHERE r.building_id = ?
    ORDER BY r.order_index, r.name
  `).all(id);
  res.json(rooms);
});

router.post('/rooms', (req, res) => {
  const { building_id, name } = req.body;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!db.prepare('SELECT id FROM buildings WHERE id = ?').get(building_id)) return res.status(404).json({ error: 'Building not found' });
  const max = db.prepare('SELECT MAX(order_index) AS m FROM rooms WHERE building_id = ?').get(building_id);
  const result = db.prepare(`
    INSERT INTO rooms (building_id, name, order_index) VALUES (?, ?, ?)
  `).run(building_id, t(name), (max.m ?? -1) + 1);
  res.status(201).json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/rooms/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const { name, order_index } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE rooms SET name = ?, order_index = ? WHERE id = ?')
    .run(t(name), order_index ?? existing.order_index, id);
  res.json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id));
});

router.delete('/rooms/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  res.status(204).send();
});

// ── Units ──────────────────────────────────────────────────────────────────

router.get('/rooms/:id/units', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const units = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM shelves WHERE unit_id = u.id) AS shelf_count,
      (SELECT COUNT(*) FROM books bk
        JOIN shelves s ON bk.shelf_id = s.id
        WHERE s.unit_id = u.id) AS book_count
    FROM units u
    WHERE u.room_id = ?
    ORDER BY u.order_index, u.name
  `).all(id);
  res.json(units);
});

router.post('/units', (req, res) => {
  const { room_id, name } = req.body;
  if (!room_id) return res.status(400).json({ error: 'room_id is required' });
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(room_id)) return res.status(404).json({ error: 'Room not found' });
  const max = db.prepare('SELECT MAX(order_index) AS m FROM units WHERE room_id = ?').get(room_id);
  const result = db.prepare(`
    INSERT INTO units (room_id, name, order_index) VALUES (?, ?, ?)
  `).run(room_id, t(name), (max.m ?? -1) + 1);
  res.status(201).json(db.prepare('SELECT * FROM units WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/units/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const { name, order_index } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const existing = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE units SET name = ?, order_index = ? WHERE id = ?')
    .run(t(name), order_index ?? existing.order_index, id);
  res.json(db.prepare('SELECT * FROM units WHERE id = ?').get(id));
});

router.delete('/units/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  if (!db.prepare('SELECT id FROM units WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM units WHERE id = ?').run(id);
  res.status(204).send();
});

router.put('/rooms/order', (req, res) => {
  const { building_id, ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const update = db.prepare('UPDATE rooms SET order_index = ? WHERE id = ? AND building_id = ?');
  db.transaction(() => ids.forEach((id, i) => update.run(i, id, building_id)))();
  res.status(204).end();
});

router.put('/units/order', (req, res) => {
  const { room_id, ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const update = db.prepare('UPDATE units SET order_index = ? WHERE id = ? AND room_id = ?');
  db.transaction(() => ids.forEach((id, i) => update.run(i, id, room_id)))();
  res.status(204).end();
});

// ── Shelves ────────────────────────────────────────────────────────────────

router.get('/units/:id/shelves', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const shelves = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM books WHERE shelf_id = s.id) AS book_count
    FROM shelves s
    WHERE s.unit_id = ?
    ORDER BY s.order_index, s.label
  `).all(id);
  res.json(shelves);
});

router.post('/shelves', (req, res) => {
  const { unit_id, label } = req.body;
  if (!unit_id) return res.status(400).json({ error: 'unit_id is required' });
  if (!label?.toString().trim()) return res.status(400).json({ error: 'Label is required' });
  if (!db.prepare('SELECT id FROM units WHERE id = ?').get(unit_id)) return res.status(404).json({ error: 'Unit not found' });
  const max = db.prepare('SELECT MAX(order_index) AS m FROM shelves WHERE unit_id = ?').get(unit_id);
  const result = db.prepare(`
    INSERT INTO shelves (unit_id, label, order_index) VALUES (?, ?, ?)
  `).run(unit_id, t(String(label)), (max.m ?? -1) + 1);
  res.status(201).json(db.prepare('SELECT * FROM shelves WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/shelves/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const { label, order_index } = req.body;
  if (!label?.toString().trim()) return res.status(400).json({ error: 'Label is required' });
  const existing = db.prepare('SELECT * FROM shelves WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE shelves SET label = ?, order_index = ? WHERE id = ?')
    .run(t(String(label)), order_index ?? existing.order_index, id);
  res.json(db.prepare('SELECT * FROM shelves WHERE id = ?').get(id));
});

router.delete('/shelves/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  if (!db.prepare('SELECT id FROM shelves WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM shelves WHERE id = ?').run(id);
  res.status(204).send();
});

// ── Owned books with no shelf assigned ────────────────────────────────────

router.get('/unshelfed', (_req, res) => {
  const books = db.prepare(`
    SELECT id, title, author, cover_path, status, rating
    FROM books
    WHERE owned = 1 AND (format = 'physical' OR format IS NULL) AND shelf_id IS NULL AND unit_id IS NULL AND room_id IS NULL AND building_id IS NULL
    ORDER BY title
  `).all().map(b => ({ ...b, cover_path: b.cover_path ? `/uploads/${b.cover_path}` : null }));
  res.json(books);
});

// ── Books in a building (all shelves + unit-only + room-only + building-only)

router.get('/buildings/:id/books', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const books = db.prepare(`
    SELECT b.id, b.title, b.author, b.cover_path, b.status, b.rating, b.series, b.series_number, b.format
    FROM books b
    -- resolve effective room
    LEFT JOIN rooms       r_direct ON r_direct.id = b.room_id
    LEFT JOIN units       u_for_r  ON u_for_r.id  = b.unit_id
    LEFT JOIN rooms       r_via_u  ON r_via_u.id  = u_for_r.room_id
    LEFT JOIN shelves     s_direct ON s_direct.id = b.shelf_id
    LEFT JOIN units       u_via_s  ON u_via_s.id  = s_direct.unit_id
    LEFT JOIN rooms       r_via_s  ON r_via_s.id  = u_via_s.room_id
    -- resolve effective unit
    LEFT JOIN units       u_direct ON u_direct.id = b.unit_id
    LEFT JOIN units       u_via_sh ON u_via_sh.id = s_direct.unit_id
    WHERE b.owned = 1
      AND (
        b.building_id = ?
        OR r_direct.building_id = ?
        OR r_via_u.building_id  = ?
        OR r_via_s.building_id  = ?
      )
    ORDER BY
      COALESCE(r_direct.order_index, r_via_u.order_index, r_via_s.order_index, 0),
      COALESCE(r_direct.name,        r_via_u.name,        r_via_s.name),
      COALESCE(u_direct.order_index, u_via_sh.order_index, 0),
      COALESCE(u_direct.name,        u_via_sh.name),
      COALESCE(s_direct.order_index, 0),
      CASE WHEN b.shelf_position IS NULL THEN 1 ELSE 0 END,
      b.shelf_position,
      COALESCE(b.series, b.title), b.series_number, b.title
  `).all(id, id, id, id).map(b => ({ ...b, cover_path: b.cover_path ? `/uploads/${b.cover_path}` : null }));
  res.json(books);
});

// ── Books in a room (all shelves + unit-only + room-only) ─────────────────

router.get('/rooms/:id/books', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const books = db.prepare(`
    SELECT b.id, b.title, b.author, b.cover_path, b.status, b.rating, b.series, b.series_number, b.format
    FROM books b
    LEFT JOIN units   u_direct ON u_direct.id = b.unit_id
    LEFT JOIN shelves s_direct ON s_direct.id = b.shelf_id
    LEFT JOIN units   u_via_s  ON u_via_s.id  = s_direct.unit_id
    WHERE b.owned = 1
      AND (
        b.room_id = ?
        OR u_direct.room_id = ?
        OR u_via_s.room_id  = ?
      )
    ORDER BY
      COALESCE(u_direct.order_index, u_via_s.order_index, 0),
      COALESCE(u_direct.name,        u_via_s.name),
      COALESCE(s_direct.order_index, 0),
      CASE WHEN b.shelf_position IS NULL THEN 1 ELSE 0 END,
      b.shelf_position,
      COALESCE(b.series, b.title), b.series_number, b.title
  `).all(id, id, id).map(b => ({ ...b, cover_path: b.cover_path ? `/uploads/${b.cover_path}` : null }));
  res.json(books);
});

// ── Books in a unit (all shelves + unit-only) ──────────────────────────────

router.get('/units/:id/books', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const books = db.prepare(`
    SELECT b.id, b.title, b.author, b.cover_path, b.status, b.rating, b.series, b.series_number, b.format
    FROM books b
    LEFT JOIN shelves s ON s.id = b.shelf_id
    WHERE b.owned = 1
      AND (b.unit_id = ? OR s.unit_id = ?)
    ORDER BY
      COALESCE(s.order_index, 0),
      CASE WHEN b.shelf_position IS NULL THEN 1 ELSE 0 END,
      b.shelf_position,
      COALESCE(b.series, b.title), b.series_number, b.title
  `).all(id, id).map(b => ({ ...b, cover_path: b.cover_path ? `/uploads/${b.cover_path}` : null }));
  res.json(books);
});

// ── Books on a shelf ───────────────────────────────────────────────────────

router.get('/shelves/:id/books', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const books = db.prepare(`
    SELECT b.id, b.title, b.author, b.cover_path, b.status, b.rating, b.series, b.series_number, b.format
    FROM books b
    WHERE b.shelf_id = ?
    ORDER BY CASE WHEN b.shelf_position IS NULL THEN 1 ELSE 0 END, b.shelf_position, b.series, b.series_number, b.title
  `).all(id).map(b => ({ ...b, cover_path: b.cover_path ? `/uploads/${b.cover_path}` : null }));
  res.json(books);
});

router.put('/shelves/:id/order', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const update = db.prepare('UPDATE books SET shelf_position = ? WHERE id = ? AND shelf_id = ?');
  db.transaction(() => ids.forEach((bookId, pos) => update.run(pos, bookId, id)))();
  res.status(204).end();
});

// ── Location breadcrumb for a book ─────────────────────────────────────────

router.get('/location/:bookId', (req, res) => {
  const bookId = Number(req.params.bookId);
  if (!Number.isInteger(bookId) || bookId < 1) return res.status(400).json({ error: 'Invalid id' });

  const full = db.prepare(`
    SELECT
      b.id   AS building_id,   b.name AS building,   b.proximity,
      r.id   AS room_id,       r.name AS room,
      u.id   AS unit_id,       u.name AS unit,
      s.id   AS shelf_id,      s.label AS shelf
    FROM books bk
    JOIN shelves s   ON bk.shelf_id    = s.id
    JOIN units u     ON s.unit_id      = u.id
    JOIN rooms r     ON u.room_id      = r.id
    JOIN buildings b ON r.building_id  = b.id
    WHERE bk.id = ?
  `).get(bookId);
  if (full) return res.json(full);

  const unitLevel = db.prepare(`
    SELECT
      b.id AS building_id, b.name AS building, b.proximity,
      r.id AS room_id,     r.name AS room,
      u.id AS unit_id,     u.name AS unit
    FROM books bk
    JOIN units u     ON bk.unit_id    = u.id
    JOIN rooms r     ON u.room_id     = r.id
    JOIN buildings b ON r.building_id = b.id
    WHERE bk.id = ?
  `).get(bookId);
  if (unitLevel) return res.json(unitLevel);

  const roomLevel = db.prepare(`
    SELECT
      b.id AS building_id, b.name AS building, b.proximity,
      r.id AS room_id,     r.name AS room
    FROM books bk
    JOIN rooms r     ON bk.room_id    = r.id
    JOIN buildings b ON r.building_id = b.id
    WHERE bk.id = ?
  `).get(bookId);
  if (roomLevel) return res.json(roomLevel);

  const partial = db.prepare(`
    SELECT b.id AS building_id, b.name AS building, b.proximity
    FROM books bk
    JOIN buildings b ON bk.building_id = b.id
    WHERE bk.id = ?
  `).get(bookId);
  res.json(partial ?? null);
});

export default router;
