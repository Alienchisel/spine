CREATE TABLE IF NOT EXISTS buildings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  proximity   TEXT    NOT NULL DEFAULT 'home' CHECK(proximity IN ('home', 'nearby', 'remote')),
  notes       TEXT,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS units (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shelves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  label       TEXT    NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE books ADD COLUMN shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL;

-- ── Buildings ────────────────────────────────────────────────────────────────
INSERT INTO buildings (name, proximity, order_index) VALUES ('Home',             'home',   0);
INSERT INTO buildings (name, proximity, order_index) VALUES ('Work',             'nearby', 1);
INSERT INTO buildings (name, proximity, order_index) VALUES ('Mom''s Apartment', 'remote', 2);

-- ── Home rooms from existing book data ───────────────────────────────────────
INSERT INTO rooms (building_id, name, order_index)
SELECT
  (SELECT id FROM buildings WHERE name = 'Home'),
  shelf_room,
  ROW_NUMBER() OVER (ORDER BY shelf_room) - 1
FROM books
WHERE shelf_room IS NOT NULL
GROUP BY shelf_room;

-- ── Work room ────────────────────────────────────────────────────────────────
INSERT INTO rooms (building_id, name, order_index)
VALUES ((SELECT id FROM buildings WHERE name = 'Work'), 'Office', 0);

-- ── Home units from existing book data ───────────────────────────────────────
INSERT INTO units (room_id, name, order_index)
SELECT
  (SELECT r.id FROM rooms r
    JOIN buildings b ON r.building_id = b.id
    WHERE b.name = 'Home' AND r.name = books.shelf_room),
  shelf_unit,
  0
FROM books
WHERE shelf_room IS NOT NULL AND shelf_unit IS NOT NULL
GROUP BY shelf_room, shelf_unit;

-- ── Work unit ────────────────────────────────────────────────────────────────
INSERT INTO units (room_id, name, order_index)
VALUES (
  (SELECT r.id FROM rooms r JOIN buildings b ON r.building_id = b.id
   WHERE b.name = 'Work' AND r.name = 'Office'),
  'Desk', 0
);

-- ── Home shelves from existing book data ─────────────────────────────────────
INSERT INTO shelves (unit_id, label, order_index)
SELECT
  (SELECT u.id FROM units u
    JOIN rooms r ON u.room_id = r.id
    JOIN buildings b ON r.building_id = b.id
    WHERE b.name = 'Home' AND r.name = books.shelf_room AND u.name = books.shelf_unit),
  CAST(shelf_number AS TEXT),
  shelf_number - 1
FROM books
WHERE shelf_room IS NOT NULL AND shelf_unit IS NOT NULL AND shelf_number IS NOT NULL
GROUP BY shelf_room, shelf_unit, shelf_number;

-- ── Work shelf ───────────────────────────────────────────────────────────────
INSERT INTO shelves (unit_id, label, order_index)
VALUES (
  (SELECT u.id FROM units u
    JOIN rooms r ON u.room_id = r.id
    JOIN buildings b ON r.building_id = b.id
    WHERE b.name = 'Work' AND r.name = 'Office' AND u.name = 'Desk'),
  '1', 0
);

-- ── Assign shelf_id to Home books with full location data ────────────────────
UPDATE books SET shelf_id = (
  SELECT s.id FROM shelves s
  JOIN units u ON s.unit_id = u.id
  JOIN rooms r ON u.room_id = r.id
  JOIN buildings b ON r.building_id = b.id
  WHERE b.name = 'Home'
    AND r.name = books.shelf_room
    AND u.name = books.shelf_unit
    AND s.label = CAST(books.shelf_number AS TEXT)
)
WHERE shelf_room IS NOT NULL AND shelf_unit IS NOT NULL AND shelf_number IS NOT NULL;

-- ── Assign Loeb volumes to Work → Office → Desk → Shelf 1 ───────────────────
UPDATE books SET shelf_id = (
  SELECT s.id FROM shelves s
  JOIN units u ON s.unit_id = u.id
  JOIN rooms r ON u.room_id = r.id
  JOIN buildings b ON r.building_id = b.id
  WHERE b.name = 'Work' AND r.name = 'Office' AND u.name = 'Desk' AND s.label = '1'
)
WHERE id BETWEEN 20 AND 28;
