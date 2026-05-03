import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('shelf', () => {
  let url;
  let close;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  async function req(method, path, body) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, body: data };
  }

  describe('buildings', () => {
    it('creates a building', async () => {
      const { status, body } = await req('POST', '/api/shelf/buildings', { name: 'Home' });
      assert.equal(status, 201);
      assert.equal(body.name, 'Home');
      assert.ok(body.id);
    });

    it('rejects missing name', async () => {
      const { status } = await req('POST', '/api/shelf/buildings', { name: '' });
      assert.equal(status, 400);
    });

    it('rejects invalid proximity', async () => {
      const { status } = await req('POST', '/api/shelf/buildings', { name: 'X', proximity: 'orbit' });
      assert.equal(status, 400);
    });

    it('returns building on GET', async () => {
      const { body: created } = await req('POST', '/api/shelf/buildings', { name: 'Flat' });
      const { status, body } = await req('GET', `/api/shelf/buildings/${created.id}`);
      assert.equal(status, 200);
      assert.equal(body.name, 'Flat');
    });

    it('updates building name', async () => {
      const { body: created } = await req('POST', '/api/shelf/buildings', { name: 'Old Name' });
      const { status, body } = await req('PUT', `/api/shelf/buildings/${created.id}`, { name: 'New Name' });
      assert.equal(status, 200);
      assert.equal(body.name, 'New Name');
    });

    it('deletes a building', async () => {
      const { body: created } = await req('POST', '/api/shelf/buildings', { name: 'Doomed' });
      const { status } = await req('DELETE', `/api/shelf/buildings/${created.id}`);
      assert.equal(status, 204);
      const { status: s } = await req('GET', `/api/shelf/buildings/${created.id}`);
      assert.equal(s, 404);
    });

  });

  describe('rooms, units, shelves hierarchy', () => {
    let buildingId;
    let roomId;
    let unitId;
    let shelfId;

    before(async () => {
      const { body: b } = await req('POST', '/api/shelf/buildings', { name: 'Test Building' });
      buildingId = b.id;
      const { body: r } = await req('POST', '/api/shelf/rooms', { building_id: buildingId, name: 'Test Room' });
      roomId = r.id;
      const { body: u } = await req('POST', '/api/shelf/units', { room_id: roomId, name: 'Test Unit' });
      unitId = u.id;
      const { body: s } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: 'A' });
      shelfId = s.id;
    });

    it('creates room under building', async () => {
      const { status, body } = await req('GET', `/api/shelf/buildings/${buildingId}/rooms`);
      assert.equal(status, 200);
      assert.ok(body.some(r => r.id === roomId));
    });

    it('creates unit under room', async () => {
      const { status, body } = await req('GET', `/api/shelf/rooms/${roomId}/units`);
      assert.equal(status, 200);
      assert.ok(body.some(u => u.id === unitId));
    });

    it('creates shelf under unit', async () => {
      const { status, body } = await req('GET', `/api/shelf/units/${unitId}/shelves`);
      assert.equal(status, 200);
      assert.ok(body.some(s => s.id === shelfId));
    });

    it('room POST rejects missing building_id', async () => {
      const { status } = await req('POST', '/api/shelf/rooms', { name: 'No Building' });
      assert.equal(status, 400);
    });

    it('room POST returns 404 for unknown building', async () => {
      const { status } = await req('POST', '/api/shelf/rooms', { building_id: 99999, name: 'Ghost Room' });
      assert.equal(status, 404);
    });

    it('GET /api/shelf/tree returns nested structure', async () => {
      const { status, body } = await req('GET', '/api/shelf/tree');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      const building = body.find(b => b.id === buildingId);
      assert.ok(building, 'building in tree');
      const room = building.rooms.find(r => r.id === roomId);
      assert.ok(room, 'room in tree');
      const unit = room.units.find(u => u.id === unitId);
      assert.ok(unit, 'unit in tree');
      const shelf = unit.shelves.find(s => s.id === shelfId);
      assert.ok(shelf, 'shelf in tree');
    });

    it('all four order routes return 400 when ids is not an array', async () => {
      const paths = [
        '/api/shelf/buildings/order',
        '/api/shelf/rooms/order',
        '/api/shelf/units/order',
        `/api/shelf/shelves/${shelfId}/order`,
      ];
      for (const path of paths) {
        const { status, body } = await req('PUT', path, { ids: 'bad' });
        assert.equal(status, 400, `PUT ${path} should be 400`);
        assert.equal(body.error, 'ids must be an array', `PUT ${path} should have 'ids must be an array'`);
      }
    });

    it('PUT /api/shelf/shelves/:id/order returns 400 for malformed shelf id', async () => {
      // Distinct from the ids-not-array branch — :id parser short-circuits first.
      const { status, body } = await req('PUT', '/api/shelf/shelves/abc/order', { ids: [] });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid id');
    });

    it('POST /api/shelf/units returns 400 when room_id is missing', async () => {
      const { status, body } = await req('POST', '/api/shelf/units', { name: 'Bookcase' });
      assert.equal(status, 400);
      assert.equal(body.error, 'room_id is required');
    });

    it('POST /api/shelf/units returns 404 when room_id points to no room', async () => {
      const { status, body } = await req('POST', '/api/shelf/units', { room_id: 999999, name: 'Phantom' });
      assert.equal(status, 404);
      assert.equal(body.error, 'Room not found');
    });

    it('POST /api/shelf/shelves returns 400 when unit_id is missing', async () => {
      const { status, body } = await req('POST', '/api/shelf/shelves', { label: 'Top' });
      assert.equal(status, 400);
      assert.equal(body.error, 'unit_id is required');
    });

    it('POST /api/shelf/shelves returns 400 when label is missing', async () => {
      const { status, body } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: '' });
      assert.equal(status, 400);
      assert.equal(body.error, 'Label is required');
    });

    it('PUT /api/shelf/shelves/:id returns 400 when label is missing', async () => {
      const { status, body } = await req('PUT', `/api/shelf/shelves/${shelfId}`, { label: '' });
      assert.equal(status, 400);
      assert.equal(body.error, 'Label is required');
    });

    it('PUT for unknown buildings/rooms/units/shelves returns 404 Not found', async () => {
      // Validation runs before the existence check, so each body carries a
      // valid name/label to reach the 404 branch.
      const cases = [
        { path: '/api/shelf/buildings/999999', body: { name: 'Ghost Building' } },
        { path: '/api/shelf/rooms/999999',     body: { name: 'Ghost Room' } },
        { path: '/api/shelf/units/999999',     body: { name: 'Ghost Unit' } },
        { path: '/api/shelf/shelves/999999',   body: { label: 'Ghost Shelf' } },
      ];
      for (const { path, body } of cases) {
        const { status, body: resBody } = await req('PUT', path, body);
        assert.equal(status, 404, `PUT ${path} should be 404`);
        assert.equal(resBody.error, 'Not found', `PUT ${path} should have 'Not found'`);
      }
    });

    it('DELETE for unknown buildings/rooms/units/shelves returns 404 Not found', async () => {
      const paths = [
        '/api/shelf/buildings/999999',
        '/api/shelf/rooms/999999',
        '/api/shelf/units/999999',
        '/api/shelf/shelves/999999',
      ];
      for (const path of paths) {
        const { status, body } = await req('DELETE', path);
        assert.equal(status, 404, `DELETE ${path} should be 404`);
        assert.equal(body.error, 'Not found', `DELETE ${path} should have 'Not found'`);
      }
    });

    it('GET singletons and children/location on malformed ids return 400 Invalid id', async () => {
      const paths = [
        '/api/shelf/buildings/abc',
        '/api/shelf/buildings/abc/rooms',
        '/api/shelf/rooms/abc/units',
        '/api/shelf/units/abc/shelves',
        '/api/shelf/location/abc',
      ];
      for (const path of paths) {
        const { status, body } = await req('GET', path);
        assert.equal(status, 400, `GET ${path} should be 400`);
        assert.equal(body.error, 'Invalid id', `GET ${path} should have 'Invalid id'`);
      }
    });

    it('GET /api/shelf/buildings/:id returns 404 for unknown id', async () => {
      const { status, body } = await req('GET', '/api/shelf/buildings/999999');
      assert.equal(status, 404);
      assert.equal(body.error, 'Not found');
    });

    it('GET .../books on malformed shelf hierarchy ids return 400 Invalid id', async () => {
      const paths = [
        '/api/shelf/buildings/abc/books',
        '/api/shelf/rooms/abc/books',
        '/api/shelf/units/abc/books',
        '/api/shelf/shelves/abc/books',
      ];
      for (const path of paths) {
        const { status, body } = await req('GET', path);
        assert.equal(status, 400, `GET ${path} should be 400`);
        assert.equal(body.error, 'Invalid id', `GET ${path} should have 'Invalid id'`);
      }
    });

    it('PUT/DELETE on malformed shelf hierarchy ids return 400 Invalid id', async () => {
      // The id parser short-circuits before any validation or DB work for
      // every singleton route in the hierarchy. The /order routes are
      // excluded — they have their own ids-array contract.
      const cases = [
        { method: 'PUT',    path: '/api/shelf/buildings/abc' },
        { method: 'PUT',    path: '/api/shelf/rooms/abc' },
        { method: 'PUT',    path: '/api/shelf/units/abc' },
        { method: 'PUT',    path: '/api/shelf/shelves/abc' },
        { method: 'DELETE', path: '/api/shelf/buildings/abc' },
        { method: 'DELETE', path: '/api/shelf/rooms/abc' },
        { method: 'DELETE', path: '/api/shelf/units/abc' },
        { method: 'DELETE', path: '/api/shelf/shelves/abc' },
      ];
      for (const { method, path } of cases) {
        const body = method === 'PUT' ? { name: 'X', label: 'X' } : undefined;
        const { status, body: resBody } = await req(method, path, body);
        assert.equal(status, 400, `${method} ${path} should be 400`);
        assert.equal(resBody.error, 'Invalid id', `${method} ${path} should have 'Invalid id'`);
      }
    });

    it('all rooms/units name guards return 400 with "Name is required"', async () => {
      // Five unpinned guards across POST/PUT for buildings/rooms/units share
      // the same contract; one table-driven test keeps validation symmetric
      // across the hierarchy.
      const cases = [
        { method: 'PUT',    path: `/api/shelf/buildings/${buildingId}`, body: { name: '' } },
        { method: 'POST',   path: '/api/shelf/rooms',                   body: { building_id: buildingId, name: '' } },
        { method: 'PUT',    path: `/api/shelf/rooms/${roomId}`,         body: { name: '' } },
        { method: 'POST',   path: '/api/shelf/units',                   body: { room_id: roomId, name: '' } },
        { method: 'PUT',    path: `/api/shelf/units/${unitId}`,         body: { name: '' } },
      ];
      for (const { method, path, body } of cases) {
        const { status, body: resBody } = await req(method, path, body);
        assert.equal(status, 400, `${method} ${path} should be 400`);
        assert.equal(resBody.error, 'Name is required', `${method} ${path} should have 'Name is required'`);
      }
    });

    it('POST /api/shelf/shelves returns 404 when unit_id points to no unit', async () => {
      const { status, body } = await req('POST', '/api/shelf/shelves', { unit_id: 999999, label: 'Ghost' });
      assert.equal(status, 404);
      assert.equal(body.error, 'Unit not found');
    });
  });

  describe('unshelfed and location', () => {
    let buildingId;
    let roomId;
    let unitId;
    let shelfId;
    let shelfedBookId;
    let unshelfedBookId;
    let unitBookId;
    let roomBookId;
    let buildingBookId;
    let unownedShelvedBookId;

    before(async () => {
      const { body: b } = await req('POST', '/api/shelf/buildings', { name: 'Location Building' });
      buildingId = b.id;
      const { body: r } = await req('POST', '/api/shelf/rooms', { building_id: buildingId, name: 'Location Room' });
      roomId = r.id;
      const { body: u } = await req('POST', '/api/shelf/units', { room_id: roomId, name: 'Location Unit' });
      unitId = u.id;
      const { body: s } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: 'B' });
      shelfId = s.id;

      const { body: sb } = await req('POST', '/api/books', { title: 'On Shelf', owned: true, shelf_id: shelfId });
      shelfedBookId = sb.id;
      const { body: ub } = await req('POST', '/api/books', { title: 'Unshelfed Owned', owned: true });
      unshelfedBookId = ub.id;
      const { body: ub2 } = await req('POST', '/api/books', { title: 'Unit Only Book', owned: true, unit_id: unitId });
      unitBookId = ub2.id;
      const { body: rb } = await req('POST', '/api/books', { title: 'Room Only Book', owned: true, room_id: roomId });
      roomBookId = rb.id;
      const { body: bb } = await req('POST', '/api/books', { title: 'Building Book', owned: true, building_id: buildingId });
      buildingBookId = bb.id;
      const { body: us } = await req('POST', '/api/books', { title: 'Unowned Shelved', owned: false, shelf_id: shelfId });
      unownedShelvedBookId = us.id;
    });

    it('GET /api/shelf/unshelfed includes owned books with no location', async () => {
      const { body } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(body.some(b => b.id === unshelfedBookId));
    });

    it('GET /api/shelf/unshelfed excludes books with a shelf assignment', async () => {
      const { body } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(!body.some(b => b.id === shelfedBookId));
    });

    it('GET /api/shelf/unshelfed excludes books at any location tier', async () => {
      // The SQL requires shelf_id, unit_id, room_id, AND building_id all NULL.
      // shelfedBookId is covered by the prior test; pin the other three tiers.
      const { body } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(!body.some(b => b.id === unitBookId), 'unit-level book should not appear');
      assert.ok(!body.some(b => b.id === roomBookId), 'room-level book should not appear');
      assert.ok(!body.some(b => b.id === buildingBookId), 'building-level book should not appear');
    });

    it('GET /api/shelf/unshelfed normalizes cover_path back to /uploads/<filename>', async () => {
      // Shelf routes do their own cover mapping (separate from the book list
      // path that uses toCoverUrl). The stored value is a bare filename; the
      // response must surface it with the /uploads/ prefix restored.
      const filename = '1234567890-abcdef.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'cover normalize ' + Math.random().toString(36).slice(2, 6),
        format: 'physical',
        owned: true,
        cover_path: `/uploads/${filename}`,
      });
      const { body } = await req('GET', '/api/shelf/unshelfed');
      const found = body.find(b => b.id === created.id);
      assert.ok(found, 'created book should appear in unshelfed');
      assert.equal(found.cover_path, `/uploads/${filename}`);
    });

    it('GET /api/shelf/unshelfed excludes unowned physical books', async () => {
      // The route filters owned=1 — an unowned book with no location must
      // not appear, regardless of format.
      const { body: created } = await req('POST', '/api/books', {
        title: 'unowned unshelfed ' + Math.random().toString(36).slice(2, 6),
        format: 'physical',
        owned: false,
      });
      const { body } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(!body.some(b => b.id === created.id),
        'unowned book must not appear in unshelfed');
    });

    it('GET /api/shelf/unshelfed excludes non-physical books even when location-free', async () => {
      // The route restricts to format='physical' OR format IS NULL because
      // shelves only hold physical books. An owned ebook or audiobook with
      // no location must not appear.
      const { body: ab } = await req('POST', '/api/books', {
        title: 'unshelfed audio ' + Math.random().toString(36).slice(2, 6),
        format: 'audiobook',
        owned: true,
      });
      const { body: eb } = await req('POST', '/api/books', {
        title: 'unshelfed ebook ' + Math.random().toString(36).slice(2, 6),
        format: 'ebook',
        owned: true,
      });
      const { body } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(!body.some(b => b.id === ab.id), 'audiobook must not appear in unshelfed');
      assert.ok(!body.some(b => b.id === eb.id), 'ebook must not appear in unshelfed');
    });

    it('GET /api/shelf/location/:bookId returns full shelf breadcrumb', async () => {
      const { status, body } = await req('GET', `/api/shelf/location/${shelfedBookId}`);
      assert.equal(status, 200);
      assert.equal(body.shelf_id, shelfId);
      assert.equal(body.unit_id, unitId);
      assert.equal(body.room_id, roomId);
      assert.equal(body.building_id, buildingId);
    });

    it('GET /api/shelf/location/:bookId returns unit-level breadcrumb', async () => {
      const { body } = await req('GET', `/api/shelf/location/${unitBookId}`);
      assert.equal(body.unit_id, unitId);
      assert.equal(body.room_id, roomId);
      assert.equal(body.building_id, buildingId);
      assert.equal(body.shelf_id, undefined);
    });

    it('GET /api/shelf/location/:bookId returns building-level breadcrumb', async () => {
      const { body } = await req('GET', `/api/shelf/location/${buildingBookId}`);
      assert.equal(body.building_id, buildingId);
      assert.equal(body.room_id, undefined);
    });

    it('GET /api/shelf/location/:bookId returns null for unplaced book', async () => {
      const { body } = await req('GET', `/api/shelf/location/${unshelfedBookId}`);
      assert.equal(body, null);
    });

    it('GET /api/shelf/location/:bookId returns 200 with null for an unknown book id', async () => {
      // Lookup-not-resource contract: an unknown but valid-looking id should
      // behave like an unplaced book, not 404. Prevents drift over time.
      const { status, body } = await req('GET', '/api/shelf/location/999999');
      assert.equal(status, 200);
      assert.equal(body, null);
    });

    it('GET /api/shelf/buildings/:id/books includes books at every placement level', async () => {
      // Building drilldown cascades all four levels: shelf, unit, room, and
      // direct building. Asserting all four pins the route's full SQL
      // contract (routes/shelf.js:303).
      const { body } = await req('GET', `/api/shelf/buildings/${buildingId}/books`);
      assert.ok(body.some(b => b.id === shelfedBookId), 'shelfed book should appear');
      assert.ok(body.some(b => b.id === unitBookId), 'unit-level book should appear');
      assert.ok(body.some(b => b.id === roomBookId), 'room-level book should appear');
      assert.ok(body.some(b => b.id === buildingBookId), 'building-level book should appear');
    });

    it('GET /api/shelf/units/:id/books includes shelf and unit-level books, not room-only', async () => {
      // SQL covers two placement levels: directly on a unit, or on a shelf
      // in that unit. Books placed at the room or building level are
      // correctly excluded.
      const { status, body } = await req('GET', `/api/shelf/units/${unitId}/books`);
      assert.equal(status, 200);
      assert.ok(body.some(b => b.id === shelfedBookId), 'shelfed book should appear');
      assert.ok(body.some(b => b.id === unitBookId), 'unit-level book should appear');
      assert.ok(!body.some(b => b.id === buildingBookId),
        'building-level book should NOT appear in unit drilldown');
    });

    it('all four drilldowns exclude unowned books even when shelved', async () => {
      // Each route filters owned=1. An unowned book sitting on a shelf in
      // the hierarchy should not surface in any drilldown.
      const paths = [
        `/api/shelf/buildings/${buildingId}/books`,
        `/api/shelf/rooms/${roomId}/books`,
        `/api/shelf/units/${unitId}/books`,
        `/api/shelf/shelves/${shelfId}/books`,
      ];
      for (const path of paths) {
        const { status, body } = await req('GET', path);
        assert.equal(status, 200, `GET ${path} should be 200`);
        assert.ok(!body.some(b => b.id === unownedShelvedBookId),
          `unowned shelved book must not appear in ${path}`);
      }
    });

    it('all four drilldowns normalize cover_path back to /uploads/<filename>', async () => {
      // Each route does its own b.cover_path → /uploads/<filename> mapping.
      // A book on a shelf cascades up through every level, so one fixture
      // checks all four routes.
      const filename = '5555555555-jklmno.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'cascade cover ' + Math.random().toString(36).slice(2, 6),
        format: 'physical',
        owned: true,
        shelf_id: shelfId,
        cover_path: `/uploads/${filename}`,
      });
      const paths = [
        `/api/shelf/buildings/${buildingId}/books`,
        `/api/shelf/rooms/${roomId}/books`,
        `/api/shelf/units/${unitId}/books`,
        `/api/shelf/shelves/${shelfId}/books`,
      ];
      for (const path of paths) {
        const { body } = await req('GET', path);
        const found = body.find(b => b.id === created.id);
        assert.ok(found, `book should appear in ${path}`);
        assert.equal(found.cover_path, `/uploads/${filename}`,
          `cover_path should be normalized in ${path}`);
      }
    });

    it('children-list book_count counts every descendant level and excludes unowned/building-only', async () => {
      // Build a fresh isolated hierarchy so exact counts are assertable.
      // Children-of-parent endpoints used to undercount room/unit-direct
      // placements; they now mirror /tree.
      const stem = 'count-' + Math.random().toString(36).slice(2, 6);
      const { body: bldg }  = await req('POST', '/api/shelf/buildings', { name: `${stem} bldg` });
      const { body: rm }    = await req('POST', '/api/shelf/rooms',     { building_id: bldg.id, name: `${stem} room` });
      const { body: u }     = await req('POST', '/api/shelf/units',     { room_id: rm.id,       name: `${stem} unit` });
      const { body: sh }    = await req('POST', '/api/shelf/shelves',   { unit_id: u.id,        label: `${stem} shelf` });

      // Exactly one book at each level + one unowned shelved book.
      await req('POST', '/api/books', { title: `${stem} on shelf`,    format: 'physical', owned: true,  shelf_id: sh.id });
      await req('POST', '/api/books', { title: `${stem} on unit`,     format: 'physical', owned: true,  unit_id:  u.id });
      await req('POST', '/api/books', { title: `${stem} on room`,     format: 'physical', owned: true,  room_id:  rm.id });
      await req('POST', '/api/books', { title: `${stem} on building`, format: 'physical', owned: true,  building_id: bldg.id });
      await req('POST', '/api/books', { title: `${stem} unowned`,     format: 'physical', owned: false, shelf_id: sh.id });

      // Room: shelf + unit + room-level → 3. Building-level and unowned excluded.
      const { body: rooms } = await req('GET', `/api/shelf/buildings/${bldg.id}/rooms`);
      const room = rooms.find(r => r.id === rm.id);
      assert.ok(room, 'created room should appear');
      assert.equal(room.book_count, 3, `room.book_count should be exactly 3, got ${room.book_count}`);

      // Unit: shelf + unit-level → 2. Room/building-level and unowned excluded.
      const { body: units } = await req('GET', `/api/shelf/rooms/${rm.id}/units`);
      const unit = units.find(x => x.id === u.id);
      assert.ok(unit, 'created unit should appear');
      assert.equal(unit.book_count, 2, `unit.book_count should be exactly 2, got ${unit.book_count}`);
    });

    it('children-list endpoints order by order_index', async () => {
      // Each "children of X" route ORDER BY order_index, name. New siblings
      // get monotonically increasing order_index (max+1), so the existing
      // fixtures should come back before any newly-created sibling.
      const stem = 'children-order-' + Math.random().toString(36).slice(2, 6);
      const { body: room2 }  = await req('POST', '/api/shelf/rooms',  { building_id: buildingId, name: `${stem} R` });
      const { body: unit2 }  = await req('POST', '/api/shelf/units',  { room_id: roomId,         name: `${stem} U` });
      const { body: shelf2 } = await req('POST', '/api/shelf/shelves',{ unit_id: unitId,         label: `${stem} S` });

      const cases = [
        { path: `/api/shelf/buildings/${buildingId}/rooms`,  first: roomId, second: room2.id },
        { path: `/api/shelf/rooms/${roomId}/units`,          first: unitId, second: unit2.id },
        { path: `/api/shelf/units/${unitId}/shelves`,        first: shelfId, second: shelf2.id },
      ];
      for (const { path, first, second } of cases) {
        const { body } = await req('GET', path);
        const ids = body.map(x => x.id);
        const fi = ids.indexOf(first);
        const si = ids.indexOf(second);
        assert.ok(fi !== -1 && si !== -1, `both children should appear in ${path}`);
        assert.ok(fi < si,
          `existing child (${first}) should come before newly created (${second}) in ${path}; got ${ids.join(',')}`);
      }
    });

    it('GET /api/shelf/buildings/:id/books orders shelf < unit < room < building', async () => {
      // The COALESCE(...order_index, 999999) trick puts books at higher
      // location tiers last. shelfedBookId reaches unit via shelf, unitBookId
      // is on the unit directly, roomBookId and buildingBookId fall back to
      // 999999. Pinning the hierarchy is more durable than asserting an
      // exact full order, since the last two tie and depend on title.
      const { body } = await req('GET', `/api/shelf/buildings/${buildingId}/books`);
      const ids = body.map(b => b.id);
      const idx = (id) => ids.indexOf(id);
      assert.ok(idx(shelfedBookId) >= 0, 'shelfed book should appear');
      assert.ok(idx(shelfedBookId) < idx(unitBookId),
        `shelfed should come before unit-level; got ${ids.join(',')}`);
      assert.ok(idx(unitBookId) < idx(roomBookId),
        `unit-level should come before room-level; got ${ids.join(',')}`);
      assert.ok(idx(unitBookId) < idx(buildingBookId),
        `unit-level should come before building-level; got ${ids.join(',')}`);
    });

    it('GET /api/shelf/rooms/:id/books orders shelf < unit < room', async () => {
      const { body } = await req('GET', `/api/shelf/rooms/${roomId}/books`);
      const ids = body.map(b => b.id);
      const idx = (id) => ids.indexOf(id);
      assert.ok(idx(shelfedBookId) < idx(unitBookId),
        `shelfed should come before unit-level; got ${ids.join(',')}`);
      assert.ok(idx(unitBookId) < idx(roomBookId),
        `unit-level should come before room-level; got ${ids.join(',')}`);
    });

    it('GET /api/shelf/units/:id/books orders books by shelf order_index', async () => {
      // The unit drilldown's ORDER BY puts a book on a lower-indexed shelf
      // before a book on a higher-indexed one. Newly created shelves get
      // monotonically increasing order_index (max+1), so creating two new
      // shelves here gives a deterministic ordering to assert against.
      const stem = 'unit-order ' + Math.random().toString(36).slice(2, 6);
      const { body: shelfA } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: `${stem} A` });
      const { body: shelfB } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: `${stem} B` });
      const { body: bookA } = await req('POST', '/api/books', {
        title: `${stem} on A`, format: 'physical', owned: true, shelf_id: shelfA.id,
      });
      const { body: bookB } = await req('POST', '/api/books', {
        title: `${stem} on B`, format: 'physical', owned: true, shelf_id: shelfB.id,
      });
      const { body: list } = await req('GET', `/api/shelf/units/${unitId}/books`);
      const ids = list.map(b => b.id);
      const ai = ids.indexOf(bookA.id);
      const bi = ids.indexOf(bookB.id);
      assert.ok(ai !== -1 && bi !== -1, 'both books should appear in unit drilldown');
      assert.ok(ai < bi,
        `book on shelf A (lower order_index) should come before book on shelf B; got order ${ids.join(',')}`);
    });

    it('GET /api/shelf/shelves/:id/books orders by shelf_position', async () => {
      // shelf_position is assigned by PUT /shelves/:id/order. Create two
      // books on the same shelf, set the order explicitly, and assert the
      // drilldown returns them in that order.
      const stem = 'pos ' + Math.random().toString(36).slice(2, 6);
      const { body: a } = await req('POST', '/api/books', {
        title: `${stem} A`, format: 'physical', owned: true, shelf_id: shelfId,
      });
      const { body: b } = await req('POST', '/api/books', {
        title: `${stem} B`, format: 'physical', owned: true, shelf_id: shelfId,
      });
      // Order: B first, then A.
      const { status: orderStatus } = await req('PUT', `/api/shelf/shelves/${shelfId}/order`, {
        ids: [b.id, a.id],
      });
      assert.equal(orderStatus, 204);
      const { body: list } = await req('GET', `/api/shelf/shelves/${shelfId}/books`);
      const ids = list.map(x => x.id);
      const ai = ids.indexOf(a.id);
      const bi = ids.indexOf(b.id);
      assert.ok(ai !== -1 && bi !== -1, 'both books should appear in shelf drilldown');
      assert.ok(bi < ai, `B should come before A; got order ${ids.join(',')}`);
    });

    it('GET /api/shelf/shelves/:id/books returns only books on that exact shelf', async () => {
      // Shelf drilldown is the strictest — only direct shelf_id matches. A
      // unit-level book on the parent unit should not appear.
      const { status, body } = await req('GET', `/api/shelf/shelves/${shelfId}/books`);
      assert.equal(status, 200);
      assert.ok(body.some(b => b.id === shelfedBookId), 'shelfed book should appear');
      assert.ok(!body.some(b => b.id === unitBookId),
        'unit-level book should NOT appear in shelf drilldown');
      assert.ok(!body.some(b => b.id === buildingBookId),
        'building-level book should NOT appear in shelf drilldown');
    });

    it('GET /api/shelf/rooms/:id/books includes room/unit/shelf-level books, not building-only', async () => {
      // SQL covers three placement levels: directly on a room, on a unit in
      // that room, or on a shelf in a unit in that room. A book placed only
      // at the building level is correctly excluded.
      const { status, body } = await req('GET', `/api/shelf/rooms/${roomId}/books`);
      assert.equal(status, 200);
      assert.ok(body.some(b => b.id === shelfedBookId), 'shelfed book should appear');
      assert.ok(body.some(b => b.id === unitBookId), 'unit-level book should appear');
      assert.ok(body.some(b => b.id === roomBookId), 'room-level book should appear');
      assert.ok(!body.some(b => b.id === buildingBookId),
        'building-level book should NOT appear in room drilldown');
    });
  });
});
