-- Keep only the most specific location field; clear the rest
UPDATE books SET building_id = NULL, room_id = NULL, unit_id = NULL WHERE shelf_id IS NOT NULL;
UPDATE books SET building_id = NULL, room_id = NULL WHERE unit_id IS NOT NULL AND shelf_id IS NULL;
UPDATE books SET building_id = NULL WHERE room_id IS NOT NULL AND unit_id IS NULL AND shelf_id IS NULL;
