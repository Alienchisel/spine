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

    it('deleting a shelf releases assigned books to unshelfed without deleting them', async () => {
      // The UI promises "books assigned here will lose their location"; the
      // schema enforces this via ON DELETE SET NULL on books.shelf_id. Pin
      // the user-visible behavior so a future schema or route change can't
      // accidentally cascade-delete or leave books orphaned at the shelf id.
      const stem = 'shelf-delete-' + Math.random().toString(36).slice(2, 6);
      const { body: shelf } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: `${stem} shelf` });
      const { body: book } = await req('POST', '/api/books', {
        title: `${stem} book`, format: 'physical', owned: true, shelf_id: shelf.id,
      });

      const { status: del } = await req('DELETE', `/api/shelf/shelves/${shelf.id}`);
      assert.equal(del, 204);

      const { body: location } = await req('GET', `/api/shelf/location/${book.id}`);
      assert.equal(location, null, 'book should have no resolved location after shelf delete');

      const { body: unshelfed } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(unshelfed.some(b => b.id === book.id),
        'book should reappear as unshelfed after its shelf was deleted');
    });

    it('deleting a unit releases its shelf-level and unit-level books to unshelfed', async () => {
      // CASCADE: shelves→unit, then SET NULL on books.shelf_id and books.unit_id.
      const stem = 'unit-delete-' + Math.random().toString(36).slice(2, 6);
      const { body: u }  = await req('POST', '/api/shelf/units',   { room_id: roomId, name: `${stem} unit` });
      const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: u.id,   label: `${stem} shelf` });
      const { body: shelfBook } = await req('POST', '/api/books', {
        title: `${stem} on shelf`, format: 'physical', owned: true, shelf_id: sh.id,
      });
      const { body: unitBook }  = await req('POST', '/api/books', {
        title: `${stem} on unit`,  format: 'physical', owned: true, unit_id:  u.id,
      });

      const { status: del } = await req('DELETE', `/api/shelf/units/${u.id}`);
      assert.equal(del, 204);

      for (const b of [shelfBook, unitBook]) {
        const { body: location } = await req('GET', `/api/shelf/location/${b.id}`);
        assert.equal(location, null, `book ${b.id} should have no location after unit delete`);
      }
      const { body: unshelfed } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(unshelfed.some(x => x.id === shelfBook.id), 'shelf-level book should be unshelfed');
      assert.ok(unshelfed.some(x => x.id === unitBook.id),  'unit-level book should be unshelfed');
    });

    it('deleting a room releases shelf-, unit-, and room-level books to unshelfed', async () => {
      const stem = 'room-delete-' + Math.random().toString(36).slice(2, 6);
      const { body: rm } = await req('POST', '/api/shelf/rooms',   { building_id: buildingId, name: `${stem} room` });
      const { body: u }  = await req('POST', '/api/shelf/units',   { room_id: rm.id,          name: `${stem} unit` });
      const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: u.id,           label: `${stem} shelf` });
      const { body: shelfBook } = await req('POST', '/api/books', { title: `${stem} on shelf`, format: 'physical', owned: true, shelf_id: sh.id });
      const { body: unitBook }  = await req('POST', '/api/books', { title: `${stem} on unit`,  format: 'physical', owned: true, unit_id:  u.id });
      const { body: roomBook }  = await req('POST', '/api/books', { title: `${stem} on room`,  format: 'physical', owned: true, room_id:  rm.id });

      const { status: del } = await req('DELETE', `/api/shelf/rooms/${rm.id}`);
      assert.equal(del, 204);

      const { body: unshelfed } = await req('GET', '/api/shelf/unshelfed');
      for (const b of [shelfBook, unitBook, roomBook]) {
        const { body: location } = await req('GET', `/api/shelf/location/${b.id}`);
        assert.equal(location, null, `book ${b.id} should have no location after room delete`);
        assert.ok(unshelfed.some(x => x.id === b.id), `book ${b.id} should be unshelfed`);
      }
    });

    it('deleting a building releases books at every tier to unshelfed', async () => {
      // Full cascade: building → rooms → units → shelves, plus SET NULL on
      // every books.*_id. The strongest single proof that the location
      // promise holds top-to-bottom.
      const stem = 'bldg-delete-' + Math.random().toString(36).slice(2, 6);
      const { body: bldg } = await req('POST', '/api/shelf/buildings', { name: `${stem} bldg` });
      const { body: rm }   = await req('POST', '/api/shelf/rooms',     { building_id: bldg.id, name: `${stem} room` });
      const { body: u }    = await req('POST', '/api/shelf/units',     { room_id: rm.id,       name: `${stem} unit` });
      const { body: sh }   = await req('POST', '/api/shelf/shelves',   { unit_id: u.id,        label: `${stem} shelf` });
      const { body: shelfBook } = await req('POST', '/api/books', { title: `${stem} on shelf`,    format: 'physical', owned: true, shelf_id: sh.id });
      const { body: unitBook }  = await req('POST', '/api/books', { title: `${stem} on unit`,     format: 'physical', owned: true, unit_id:  u.id });
      const { body: roomBook }  = await req('POST', '/api/books', { title: `${stem} on room`,     format: 'physical', owned: true, room_id:  rm.id });
      const { body: bldgBook }  = await req('POST', '/api/books', { title: `${stem} on building`, format: 'physical', owned: true, building_id: bldg.id });

      const { status: del } = await req('DELETE', `/api/shelf/buildings/${bldg.id}`);
      assert.equal(del, 204);

      const { body: unshelfed } = await req('GET', '/api/shelf/unshelfed');
      for (const b of [shelfBook, unitBook, roomBook, bldgBook]) {
        const { body: location } = await req('GET', `/api/shelf/location/${b.id}`);
        assert.equal(location, null, `book ${b.id} should have no location after building delete`);
        assert.ok(unshelfed.some(x => x.id === b.id), `book ${b.id} should be unshelfed`);
      }
    });

    it('GET /api/shelf/tree reflects reorder at every nested level', async () => {
      // /tree has its own ORDER BYs separate from the list/children routes.
      // It's the actual data source for the Shelf Manager and pickers, so a
      // tree-only ordering regression wouldn't surface anywhere else.
      const stem = 'tree-order-' + Math.random().toString(36).slice(2, 6);
      const { body: bA } = await req('POST', '/api/shelf/buildings', { name: `${stem} bA` });
      const { body: bB } = await req('POST', '/api/shelf/buildings', { name: `${stem} bB` });
      const { body: rA } = await req('POST', '/api/shelf/rooms', { building_id: bA.id, name: `${stem} rA` });
      const { body: rB } = await req('POST', '/api/shelf/rooms', { building_id: bA.id, name: `${stem} rB` });
      const { body: uA } = await req('POST', '/api/shelf/units', { room_id: rA.id, name: `${stem} uA` });
      const { body: uB } = await req('POST', '/api/shelf/units', { room_id: rA.id, name: `${stem} uB` });
      const { body: sA } = await req('POST', '/api/shelf/shelves', { unit_id: uA.id, label: `${stem} sA` });
      const { body: sB } = await req('POST', '/api/shelf/shelves', { unit_id: uA.id, label: `${stem} sB` });

      // Reverse every level via the canonical order routes.
      await req('PUT', '/api/shelf/buildings/order', { ids: [bB.id, bA.id] });
      await req('PUT', '/api/shelf/rooms/order',     { building_id: bA.id, ids: [rB.id, rA.id] });
      await req('PUT', '/api/shelf/units/order',     { room_id: rA.id,     ids: [uB.id, uA.id] });
      await req('PUT', '/api/shelf/shelves/order',   { unit_id: uA.id,     ids: [sB.id, sA.id] });

      const { body: tree } = await req('GET', '/api/shelf/tree');
      const buildingIds = tree.map(b => b.id);
      assert.ok(buildingIds.indexOf(bB.id) < buildingIds.indexOf(bA.id),
        `bB should come before bA in tree; got ${buildingIds.join(',')}`);

      const treeBA = tree.find(b => b.id === bA.id);
      const roomIds = treeBA.rooms.map(r => r.id);
      assert.ok(roomIds.indexOf(rB.id) < roomIds.indexOf(rA.id),
        `rB should come before rA under bA; got ${roomIds.join(',')}`);

      const treeRA = treeBA.rooms.find(r => r.id === rA.id);
      const unitIds = treeRA.units.map(u => u.id);
      assert.ok(unitIds.indexOf(uB.id) < unitIds.indexOf(uA.id),
        `uB should come before uA under rA; got ${unitIds.join(',')}`);

      const treeUA = treeRA.units.find(u => u.id === uA.id);
      const shelfIds = treeUA.shelves.map(s => s.id);
      assert.ok(shelfIds.indexOf(sB.id) < shelfIds.indexOf(sA.id),
        `sB should come before sA under uA; got ${shelfIds.join(',')}`);
    });

    it('GET /api/shelf/tree reports exact book_count at every level', async () => {
      // /tree has its own count SQL separate from the child-list endpoints,
      // so a tree-only regression wouldn't be caught by the child-list test.
      // Isolated fixture with one owned book at each tier + one unowned at
      // the shelf gives the inverse pyramid: 4 / 3 / 2 / 1.
      const stem = 'tree-count-' + Math.random().toString(36).slice(2, 6);
      const { body: bldg } = await req('POST', '/api/shelf/buildings', { name: `${stem} bldg` });
      const { body: rm }   = await req('POST', '/api/shelf/rooms',     { building_id: bldg.id, name: `${stem} room` });
      const { body: u }    = await req('POST', '/api/shelf/units',     { room_id: rm.id,       name: `${stem} unit` });
      const { body: sh }   = await req('POST', '/api/shelf/shelves',   { unit_id: u.id,        label: `${stem} shelf` });
      await req('POST', '/api/books', { title: `${stem} on shelf`,    format: 'physical', owned: true,  shelf_id: sh.id });
      await req('POST', '/api/books', { title: `${stem} on unit`,     format: 'physical', owned: true,  unit_id:  u.id });
      await req('POST', '/api/books', { title: `${stem} on room`,     format: 'physical', owned: true,  room_id:  rm.id });
      await req('POST', '/api/books', { title: `${stem} on building`, format: 'physical', owned: true,  building_id: bldg.id });
      await req('POST', '/api/books', { title: `${stem} unowned`,     format: 'physical', owned: false, shelf_id: sh.id });

      const { body: tree } = await req('GET', '/api/shelf/tree');
      const treeBldg = tree.find(b => b.id === bldg.id);
      assert.ok(treeBldg, 'created building should appear in tree');
      const treeRoom = treeBldg.rooms.find(r => r.id === rm.id);
      const treeUnit = treeRoom.units.find(x => x.id === u.id);
      const treeShelf = treeUnit.shelves.find(s => s.id === sh.id);

      assert.equal(treeBldg.book_count,  4, `building book_count: ${treeBldg.book_count}`);
      assert.equal(treeRoom.book_count,  3, `room book_count: ${treeRoom.book_count}`);
      assert.equal(treeUnit.book_count,  2, `unit book_count: ${treeUnit.book_count}`);
      assert.equal(treeShelf.book_count, 1, `shelf book_count: ${treeShelf.book_count}`);
    });

    it('all reorder routes return 400 when ids contains a malformed entry', async () => {
      // ['abc'], [0], [-1], [1.5] all used to silently no-op via the SQL
      // WHERE filter. Each route now rejects them with 400 'Invalid id'.
      const cases = [
        { path: '/api/shelf/buildings/order',           body: { ids: ['abc'] } },
        { path: '/api/shelf/rooms/order',               body: { building_id: buildingId, ids: [0] } },
        { path: '/api/shelf/units/order',               body: { room_id: roomId,         ids: [-1] } },
        { path: '/api/shelf/shelves/order',             body: { unit_id: unitId,         ids: [1.5] } },
        { path: `/api/shelf/shelves/${shelfId}/order`,  body: { ids: ['abc'] } },
      ];
      for (const { path, body } of cases) {
        const { status, body: resBody } = await req('PUT', path, body);
        assert.equal(status, 400, `PUT ${path} should be 400`);
        assert.equal(resBody.error, 'Invalid id', `PUT ${path} should have 'Invalid id'`);
      }
    });

    it('child POST routes return 400 for malformed parent id', async () => {
      // Truthy-but-malformed parent ids used to fall through to the
      // existence-check 404 ("X not found"), which was misleading. They
      // now 400 with 'Invalid id', matching the reorder routes.
      const cases = [
        { path: '/api/shelf/rooms',   body: { building_id: 'abc', name: 'X' } },
        { path: '/api/shelf/units',   body: { room_id: 'abc',     name: 'X' } },
        { path: '/api/shelf/shelves', body: { unit_id: 'abc',     label: 'X' } },
      ];
      for (const { path, body } of cases) {
        const { status, body: resBody } = await req('POST', path, body);
        assert.equal(status, 400, `POST ${path} should be 400`);
        assert.equal(resBody.error, 'Invalid id', `POST ${path} should have 'Invalid id'`);
      }
    });

    it('scoped reorder routes return 400 for malformed parent id', async () => {
      // Truthy-but-malformed parent ids used to slip past the missing-parent
      // guard and silently no-op via SQL. Now they 400 with 'Invalid id'.
      const cases = [
        { path: '/api/shelf/rooms/order',   body: { building_id: 'abc', ids: [] } },
        { path: '/api/shelf/units/order',   body: { room_id: 'abc',     ids: [] } },
        { path: '/api/shelf/shelves/order', body: { unit_id: 'abc',     ids: [] } },
      ];
      for (const { path, body } of cases) {
        const { status, body: resBody } = await req('PUT', path, body);
        assert.equal(status, 400, `PUT ${path} should be 400`);
        assert.equal(resBody.error, 'Invalid id', `PUT ${path} should have 'Invalid id'`);
      }
    });

    it('scoped reorder routes return 400 when the parent id is missing', async () => {
      // Silent no-op on missing parent_id was a real bug — drag reorder
      // failures must be visible. Each route uses the same error string as
      // its sibling POST.
      const cases = [
        { path: '/api/shelf/rooms/order',   body: { ids: [] }, error: 'building_id is required' },
        { path: '/api/shelf/units/order',   body: { ids: [] }, error: 'room_id is required' },
        { path: '/api/shelf/shelves/order', body: { ids: [] }, error: 'unit_id is required' },
      ];
      for (const { path, body, error } of cases) {
        const { status, body: resBody } = await req('PUT', path, body);
        assert.equal(status, 400, `PUT ${path} should be 400`);
        assert.equal(resBody.error, error, `PUT ${path} should have '${error}'`);
      }
    });

    it('all order routes return 400 when ids is not an array', async () => {
      // Each scoped route also validates its parent_id, so include valid
      // parent ids here to ensure the ids-array branch is what fires.
      const cases = [
        { path: '/api/shelf/buildings/order',           body: { ids: 'bad' } },
        { path: '/api/shelf/rooms/order',               body: { building_id: buildingId, ids: 'bad' } },
        { path: '/api/shelf/units/order',               body: { room_id: roomId, ids: 'bad' } },
        { path: '/api/shelf/shelves/order',             body: { unit_id: unitId, ids: 'bad' } },
        { path: `/api/shelf/shelves/${shelfId}/order`,  body: { ids: 'bad' } },
      ];
      for (const { path, body } of cases) {
        const { status, body: resBody } = await req('PUT', path, body);
        assert.equal(status, 400, `PUT ${path} should be 400`);
        assert.equal(resBody.error, 'ids must be an array', `PUT ${path} should have 'ids must be an array'`);
      }
    });

    it('PUT /api/shelf/shelves/:id/order ignores book ids belonging to a different shelf', async () => {
      // The book reorder SQL filters by shelf_id; sending a book from
      // another shelf must not affect either shelf's order.
      const stem = 'shelf-book-iso-' + Math.random().toString(36).slice(2, 6);
      const { body: u }  = await req('POST', '/api/shelf/units', { room_id: roomId, name: `${stem} unit` });
      const { body: sA } = await req('POST', '/api/shelf/shelves', { unit_id: u.id, label: `${stem} sA` });
      const { body: sB } = await req('POST', '/api/shelf/shelves', { unit_id: u.id, label: `${stem} sB` });
      const { body: a1 } = await req('POST', '/api/books', { title: `${stem} a1`, format: 'physical', owned: true, shelf_id: sA.id });
      const { body: a2 } = await req('POST', '/api/books', { title: `${stem} a2`, format: 'physical', owned: true, shelf_id: sA.id });
      // Establish initial order on shelf A: a1 before a2.
      await req('PUT', `/api/shelf/shelves/${sA.id}/order`, { ids: [a1.id, a2.id] });
      // Misfire: try to reorder shelf B using shelf A's books in reverse.
      const { status } = await req('PUT', `/api/shelf/shelves/${sB.id}/order`, { ids: [a2.id, a1.id] });
      assert.equal(status, 204);
      const { body: list } = await req('GET', `/api/shelf/shelves/${sA.id}/books`);
      const ids = list.map(b => b.id);
      const i1 = ids.indexOf(a1.id);
      const i2 = ids.indexOf(a2.id);
      assert.ok(i1 !== -1 && i2 !== -1, 'both books should still be on shelf A');
      assert.ok(i1 < i2, `shelf A's order must be unchanged; got ${ids.join(',')}`);
    });

    it('PUT /api/shelf/buildings/:id rejects invalid proximity', async () => {
      // Mirrors the existing POST proximity test; PUT has its own validation.
      const { body: bldg } = await req('POST', '/api/shelf/buildings', { name: 'proximity-put ' + Math.random().toString(36).slice(2, 6) });
      const { status, body } = await req('PUT', `/api/shelf/buildings/${bldg.id}`, { name: 'X', proximity: 'orbit' });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid proximity');
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

    it('GET /api/shelf/location/:bookId returns room-level breadcrumb', async () => {
      const { body } = await req('GET', `/api/shelf/location/${roomBookId}`);
      assert.equal(body.room_id, roomId);
      assert.equal(body.building_id, buildingId);
      assert.equal(body.unit_id, undefined);
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

    it('shelf book-list responses include the scalar fields BookCard renders', async () => {
      // BookCard reads loved / is_custom / on_readlist for badges and
      // page_count + current_page for the progress bar. Without these in
      // the SELECT, every BookCard rendered from a shelf endpoint silently
      // lacks them. Shelf endpoints only ever return physical books per the
      // ownership/format gate, so the audiobook duration branch isn't
      // exercised here — but the columns are still in the SELECT and would
      // round-trip if a non-physical book ever appeared.
      const stem = 'card-fields-' + Math.random().toString(36).slice(2, 6);
      const { body: bldg } = await req('POST', '/api/shelf/buildings', { name: `${stem} bldg` });
      const { body: rm }   = await req('POST', '/api/shelf/rooms',     { building_id: bldg.id, name: `${stem} room` });
      const { body: u }    = await req('POST', '/api/shelf/units',     { room_id: rm.id, name: `${stem} unit` });
      const { body: sh }   = await req('POST', '/api/shelf/shelves',   { unit_id: u.id, label: stem });

      // Physical reading book on the shelf — populated progress + loved badge.
      const { body: shelfed } = await req('POST', '/api/books', {
        title: `${stem} shelved`, format: 'physical', owned: true,
        status: 'reading', page_count: 400, shelf_id: sh.id,
      });
      await req('PATCH', `/api/books/${shelfed.id}`, { current_page: 120 });
      await req('PATCH', `/api/books/${shelfed.id}`, { loved: true });

      // Unshelfed: owned physical with no location, different progress, plus
      // a series so we can assert /unshelfed returns the same row shape as
      // the four drilldowns (series + series_number included).
      const { body: unshelfed } = await req('POST', '/api/books', {
        title: `${stem} unshelfed`, format: 'physical', owned: true,
        status: 'reading', page_count: 250,
        series: `${stem} Series`, series_number: 2,
      });
      await req('PATCH', `/api/books/${unshelfed.id}`, { current_page: 75 });

      const find = (body, id) => body.find(b => b.id === id);

      // Shelf drilldown — full field set for the physical reading book.
      const { body: shelfBooks } = await req('GET', `/api/shelf/shelves/${sh.id}/books`);
      const fromShelf = find(shelfBooks, shelfed.id);
      assert.ok(fromShelf, 'physical book should appear on its shelf');
      assert.equal(fromShelf.page_count,       400);
      assert.equal(fromShelf.current_page,     120);
      assert.equal(fromShelf.loved,            1);
      assert.equal(fromShelf.is_custom,        0);
      assert.equal(fromShelf.on_readlist,      0);
      // Audiobook progress columns are present (just NULL for a physical).
      assert.equal(fromShelf.duration_minutes, null);
      assert.equal(fromShelf.current_minutes,  null);

      // Unit / room / building drilldowns cascade through the same shape.
      for (const path of [
        `/api/shelf/units/${u.id}/books`,
        `/api/shelf/rooms/${rm.id}/books`,
        `/api/shelf/buildings/${bldg.id}/books`,
      ]) {
        const { body } = await req('GET', path);
        const row = find(body, shelfed.id);
        assert.ok(row, `shelved book should appear in ${path}`);
        assert.equal(row.page_count,   400);
        assert.equal(row.current_page, 120);
        assert.equal(row.loved,        1);
      }

      // /unshelfed picks up the unshelfed fixture with its progress.
      const { body: unsh } = await req('GET', '/api/shelf/unshelfed');
      const fromUnshelfed = find(unsh, unshelfed.id);
      assert.ok(fromUnshelfed, 'owned physical with no location should appear in /unshelfed');
      assert.equal(fromUnshelfed.page_count,    250);
      assert.equal(fromUnshelfed.current_page,  75);
      assert.equal(fromUnshelfed.loved,         0);
      // Shape parity with the four drilldowns: series + series_number round-trip.
      assert.equal(fromUnshelfed.series,        `${stem} Series`);
      assert.equal(fromUnshelfed.series_number, 2);
    });

    it('shelf book-list responses include authors, narrators, and tags for BookCard', async () => {
      // The byline ('by Frank Herbert') and the rate-from-card flow both
      // depend on these joined fields. Without them, ShelfView cards would
      // show no author byline AND rate-from-card would wipe all tags
      // (realTagNames(undefined) returns []).
      const stem = 'joined-' + Math.random().toString(36).slice(2, 6);
      const { body: bldg } = await req('POST', '/api/shelf/buildings', { name: `${stem} bldg` });
      const { body: rm }   = await req('POST', '/api/shelf/rooms',     { building_id: bldg.id, name: `${stem} room` });
      const { body: u }    = await req('POST', '/api/shelf/units',     { room_id: rm.id, name: `${stem} unit` });
      const { body: sh }   = await req('POST', '/api/shelf/shelves',   { unit_id: u.id, label: stem });

      const { body: book } = await req('POST', '/api/books', {
        title: `${stem} book`, format: 'physical', owned: true, shelf_id: sh.id,
        authors:   ['Frank Herbert'],
        narrators: ['Scott Brick'],
        tags:      [`${stem}-tag-A`, `${stem}-tag-B`],
      });

      // Owned physical with no location — pins /unshelfed parity since it
      // uses the same attachBookCardJoinedFields helper as the drilldowns.
      // Without this, a future refactor that dropped the helper call only
      // from /unshelfed wouldn't be caught.
      const { body: unshelfedBook } = await req('POST', '/api/books', {
        title: `${stem} unshelfed`, format: 'physical', owned: true,
        authors:   ['Ursula K. Le Guin'],
        narrators: ['Carrington MacDuffie'],
        tags:      [`${stem}-unsh-tag`],
      });

      // Every drilldown plus /unshelfed should return the joined fields.
      const checks = [
        { path: `/api/shelf/shelves/${sh.id}/books`,  bookId: book.id,         author: 'Frank Herbert',     narrator: 'Scott Brick',         tagNames: [`${stem}-tag-A`, `${stem}-tag-B`] },
        { path: `/api/shelf/units/${u.id}/books`,     bookId: book.id,         author: 'Frank Herbert',     narrator: 'Scott Brick',         tagNames: [`${stem}-tag-A`, `${stem}-tag-B`] },
        { path: `/api/shelf/rooms/${rm.id}/books`,    bookId: book.id,         author: 'Frank Herbert',     narrator: 'Scott Brick',         tagNames: [`${stem}-tag-A`, `${stem}-tag-B`] },
        { path: `/api/shelf/buildings/${bldg.id}/books`, bookId: book.id,      author: 'Frank Herbert',     narrator: 'Scott Brick',         tagNames: [`${stem}-tag-A`, `${stem}-tag-B`] },
        { path: `/api/shelf/unshelfed`,               bookId: unshelfedBook.id, author: 'Ursula K. Le Guin', narrator: 'Carrington MacDuffie', tagNames: [`${stem}-unsh-tag`] },
      ];
      for (const c of checks) {
        const { body } = await req('GET', c.path);
        const row = body.find(b => b.id === c.bookId);
        assert.ok(row, `book should appear in ${c.path}`);
        assert.deepEqual(row.authors.map(a => a.name),   [c.author]);
        assert.deepEqual(row.narrators.map(n => n.name), [c.narrator]);
        assert.equal(row.tags.length, c.tagNames.length, `tags should be populated in ${c.path}`);
        for (const tagName of c.tagNames) {
          assert.ok(row.tags.some(t => t.name === tagName), `${c.path} should include tag ${tagName}`);
        }
      }

      // Regression: with tags now present on shelf-served books, simulating
      // BookCard's rate-from-card flow must NOT wipe the tags. (Pre-fix the
      // shelf payload had no tags, so realTagNames(undefined) returned []
      // and the PUT silently nuked the book's tags.)
      const { body: shelfBooks } = await req('GET', `/api/shelf/shelves/${sh.id}/books`);
      const shelfRow = shelfBooks.find(b => b.id === book.id);
      // Mirror BookCard.handleRate: spread the shelf row, set rating,
      // forward real tag names. Note: relations must be names (strings)
      // for the PUT, not {id, name} objects.
      const { body: rated } = await req('PUT', `/api/books/${book.id}`, {
        ...shelfRow,
        rating: 4,
        authors:   shelfRow.authors.map(a => a.name),
        narrators: shelfRow.narrators.map(n => n.name),
        tags:      shelfRow.tags.filter(t => !t.virtual).map(t => t.name),
      });
      assert.equal(rated.rating, 4);
      assert.equal(rated.tags.length, 2, 'tags must survive rate-from-card');
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

    it('reorder routes ignore ids belonging to a different parent', async () => {
      // Each child-reorder SQL has ... AND parent_id = ?, so passing the
      // wrong parent should be a silent no-op. Pinning this prevents a
      // future regression that would let one parent reorder another's children.
      const stem = 'isolation-' + Math.random().toString(36).slice(2, 6);

      // Rooms: two parents (buildings), two children each.
      const { body: bldgA } = await req('POST', '/api/shelf/buildings', { name: `${stem} bldgA` });
      const { body: bldgB } = await req('POST', '/api/shelf/buildings', { name: `${stem} bldgB` });
      const { body: rA1 } = await req('POST', '/api/shelf/rooms', { building_id: bldgA.id, name: `${stem} rA1` });
      const { body: rA2 } = await req('POST', '/api/shelf/rooms', { building_id: bldgA.id, name: `${stem} rA2` });
      // Reorder targeting bldgB but with bldgA's room ids.
      await req('PUT', '/api/shelf/rooms/order', { building_id: bldgB.id, ids: [rA2.id, rA1.id] });
      const { body: roomsA } = await req('GET', `/api/shelf/buildings/${bldgA.id}/rooms`);
      const rIdx = (id) => roomsA.findIndex(r => r.id === id);
      assert.ok(rIdx(rA1.id) < rIdx(rA2.id),
        `rooms in bldgA should be unchanged; got ${roomsA.map(r => r.id).join(',')}`);

      // Units: two parents (rooms), two children each.
      const { body: rmA } = await req('POST', '/api/shelf/rooms', { building_id: bldgA.id, name: `${stem} rmA` });
      const { body: rmB } = await req('POST', '/api/shelf/rooms', { building_id: bldgA.id, name: `${stem} rmB` });
      const { body: uA1 } = await req('POST', '/api/shelf/units', { room_id: rmA.id, name: `${stem} uA1` });
      const { body: uA2 } = await req('POST', '/api/shelf/units', { room_id: rmA.id, name: `${stem} uA2` });
      await req('PUT', '/api/shelf/units/order', { room_id: rmB.id, ids: [uA2.id, uA1.id] });
      const { body: unitsA } = await req('GET', `/api/shelf/rooms/${rmA.id}/units`);
      const uIdx = (id) => unitsA.findIndex(u => u.id === id);
      assert.ok(uIdx(uA1.id) < uIdx(uA2.id),
        `units in rmA should be unchanged; got ${unitsA.map(u => u.id).join(',')}`);

      // Shelves: two parents (units), two children each.
      const { body: utA } = await req('POST', '/api/shelf/units', { room_id: rmA.id, name: `${stem} utA` });
      const { body: utB } = await req('POST', '/api/shelf/units', { room_id: rmA.id, name: `${stem} utB` });
      const { body: sA1 } = await req('POST', '/api/shelf/shelves', { unit_id: utA.id, label: `${stem} sA1` });
      const { body: sA2 } = await req('POST', '/api/shelf/shelves', { unit_id: utA.id, label: `${stem} sA2` });
      await req('PUT', '/api/shelf/shelves/order', { unit_id: utB.id, ids: [sA2.id, sA1.id] });
      const { body: shelvesA } = await req('GET', `/api/shelf/units/${utA.id}/shelves`);
      const sIdx = (id) => shelvesA.findIndex(s => s.id === id);
      assert.ok(sIdx(sA1.id) < sIdx(sA2.id),
        `shelves in utA should be unchanged; got ${shelvesA.map(s => s.id).join(',')}`);
    });

    it('GET /api/shelf/buildings orders by order_index', async () => {
      // Top-level buildings list is what ShelfView shows on initial render.
      // New buildings get monotonically increasing order_index (max+1), so
      // the earlier-created building should always come back first.
      const stem = 'bldg-list-order-' + Math.random().toString(36).slice(2, 6);
      const { body: first }  = await req('POST', '/api/shelf/buildings', { name: `${stem} first` });
      const { body: second } = await req('POST', '/api/shelf/buildings', { name: `${stem} second` });
      const { body: list } = await req('GET', '/api/shelf/buildings');
      const ids = list.map(b => b.id);
      const fi = ids.indexOf(first.id);
      const si = ids.indexOf(second.id);
      assert.ok(fi !== -1 && si !== -1, 'both buildings should appear');
      assert.ok(fi < si,
        `first-created should come before second; got ${ids.join(',')}`);
    });

    it('GET /api/shelf/buildings reports exact room_count and book_count per building', async () => {
      // Separate SQL from /tree (routes/shelf.js:60). Pin it on an isolated
      // building to keep counts assertable.
      const stem = 'list-count-' + Math.random().toString(36).slice(2, 6);
      const { body: bldg } = await req('POST', '/api/shelf/buildings', { name: `${stem} bldg` });
      // Two rooms, then place owned books at every tier.
      await req('POST', '/api/shelf/rooms', { building_id: bldg.id, name: `${stem} rA` });
      const { body: rB } = await req('POST', '/api/shelf/rooms', { building_id: bldg.id, name: `${stem} rB` });
      const { body: u } = await req('POST', '/api/shelf/units', { room_id: rB.id, name: `${stem} unit` });
      const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: u.id, label: `${stem} shelf` });
      await req('POST', '/api/books', { title: `${stem} on shelf`,    format: 'physical', owned: true,  shelf_id: sh.id });
      await req('POST', '/api/books', { title: `${stem} on unit`,     format: 'physical', owned: true,  unit_id:  u.id });
      await req('POST', '/api/books', { title: `${stem} on room`,     format: 'physical', owned: true,  room_id:  rB.id });
      await req('POST', '/api/books', { title: `${stem} on building`, format: 'physical', owned: true,  building_id: bldg.id });
      await req('POST', '/api/books', { title: `${stem} unowned`,     format: 'physical', owned: false, shelf_id: sh.id });

      const { body: list } = await req('GET', '/api/shelf/buildings');
      const found = list.find(b => b.id === bldg.id);
      assert.ok(found, 'created building should appear in the list');
      assert.equal(found.room_count, 2, `room_count: ${found.room_count}`);
      assert.equal(found.book_count, 4, `book_count: ${found.book_count}`);
    });

    it('PUT /api/shelf/shelves/order reorders shelves under a unit', async () => {
      // Mirrors rooms/order and units/order. Backend route placement matters
      // here — must come before /shelves/:id so Express doesn't capture
      // 'order' as the id parameter.
      const stem = 'shelves-reorder-' + Math.random().toString(36).slice(2, 6);
      const { body: u } = await req('POST', '/api/shelf/units', { room_id: roomId, name: `${stem} unit` });
      const { body: sA } = await req('POST', '/api/shelf/shelves', { unit_id: u.id, label: `${stem} sA` });
      const { body: sB } = await req('POST', '/api/shelf/shelves', { unit_id: u.id, label: `${stem} sB` });
      const { status } = await req('PUT', '/api/shelf/shelves/order', { unit_id: u.id, ids: [sB.id, sA.id] });
      assert.equal(status, 204);
      const { body: shelves } = await req('GET', `/api/shelf/units/${u.id}/shelves`);
      const idx = (id) => shelves.findIndex(s => s.id === id);
      assert.ok(idx(sB.id) < idx(sA.id),
        `sB should come before sA after reorder; got ${shelves.map(s => s.id).join(',')}`);
    });

    it('PUT /api/shelf/{buildings,rooms,units}/order reorders siblings', async () => {
      // The 400-rejection branch is covered above; this pins the success
      // branch — the actual drag-and-drop contract used by ShelfManager.
      // Create two fresh siblings at each level, send a reversed id list,
      // and assert the children-list GET surfaces the new order.
      const stem = 'reorder-' + Math.random().toString(36).slice(2, 6);

      // Buildings: top-level, no parent context.
      const { body: bA } = await req('POST', '/api/shelf/buildings', { name: `${stem} bA` });
      const { body: bB } = await req('POST', '/api/shelf/buildings', { name: `${stem} bB` });
      await req('PUT', '/api/shelf/buildings/order', { ids: [bB.id, bA.id] });
      const { body: buildings } = await req('GET', '/api/shelf/buildings');
      const bIdx = (id) => buildings.findIndex(x => x.id === id);
      assert.ok(bIdx(bB.id) < bIdx(bA.id),
        `bB should come before bA after reorder; got order ${buildings.map(x => x.id).join(',')}`);

      // Rooms: scoped under a fresh building so we don't perturb other tests.
      const { body: bldg } = await req('POST', '/api/shelf/buildings', { name: `${stem} parent-b` });
      const { body: rA } = await req('POST', '/api/shelf/rooms', { building_id: bldg.id, name: `${stem} rA` });
      const { body: rB } = await req('POST', '/api/shelf/rooms', { building_id: bldg.id, name: `${stem} rB` });
      await req('PUT', '/api/shelf/rooms/order', { building_id: bldg.id, ids: [rB.id, rA.id] });
      const { body: rooms } = await req('GET', `/api/shelf/buildings/${bldg.id}/rooms`);
      const rIdx = (id) => rooms.findIndex(x => x.id === id);
      assert.ok(rIdx(rB.id) < rIdx(rA.id),
        `rB should come before rA after reorder; got order ${rooms.map(x => x.id).join(',')}`);

      // Units: scoped under a fresh room.
      const { body: parentRoom } = await req('POST', '/api/shelf/rooms', { building_id: bldg.id, name: `${stem} parent-r` });
      const { body: uA } = await req('POST', '/api/shelf/units', { room_id: parentRoom.id, name: `${stem} uA` });
      const { body: uB } = await req('POST', '/api/shelf/units', { room_id: parentRoom.id, name: `${stem} uB` });
      await req('PUT', '/api/shelf/units/order', { room_id: parentRoom.id, ids: [uB.id, uA.id] });
      const { body: units } = await req('GET', `/api/shelf/rooms/${parentRoom.id}/units`);
      const uIdx = (id) => units.findIndex(x => x.id === id);
      assert.ok(uIdx(uB.id) < uIdx(uA.id),
        `uB should come before uA after reorder; got order ${units.map(x => x.id).join(',')}`);
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

    it('books with NULL shelf_position fall back to series/title order', async () => {
      // The shelf drilldown's ORDER BY is:
      //   CASE WHEN shelf_position IS NULL THEN 1 ELSE 0 END, shelf_position,
      //   titleSortExpr(COALESCE(series, title)), series_number, titleSortExpr(title)
      // Positioned books come first; the rest fall back to article-stripped
      // COALESCE(series, title) → series_number → article-stripped title.
      // This test exercises the simple alphabetical case (no article stripping
      // needed) on a fresh shelf with no reorder calls; the article-strip
      // behavior itself is covered by the dedicated tests below.
      const stem = 'fallback-' + Math.random().toString(36).slice(2, 6);
      const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: `${stem} shelf` });
      const { body: zebra } = await req('POST', '/api/books', {
        title: `${stem} Zebra`, format: 'physical', owned: true, shelf_id: sh.id,
      });
      const { body: aardvark } = await req('POST', '/api/books', {
        title: `${stem} Aardvark`, format: 'physical', owned: true, shelf_id: sh.id,
      });
      const { body: list } = await req('GET', `/api/shelf/shelves/${sh.id}/books`);
      const ids = list.map(x => x.id);
      const ai = ids.indexOf(aardvark.id);
      const zi = ids.indexOf(zebra.id);
      assert.ok(ai !== -1 && zi !== -1, 'both books should appear');
      assert.ok(ai < zi,
        `Aardvark should sort before Zebra by title fallback; got order ${ids.join(',')}`);
    });

    // Article-stripping fallback: every shelf-route ORDER BY now uses
    // titleSortExpr so 'The Odyssey' sorts under O, matching Library
    // browsing instead of dropping under T. Five drilldowns, five tests —
    // one per surface that does title-fallback.
    function makeArticleStripFixture(stem, parent) {
      // Two unpositioned, no-series books; only the article-stripping
      // expression decides their order. With strip: Odyssey < Phaedo (O<P);
      // without: Phaedo < The Odyssey (P<T).
      return Promise.all([
        req('POST', '/api/books', { title: `The Odyssey ${stem}`, format: 'physical', owned: true, ...parent }),
        req('POST', '/api/books', { title: `Phaedo ${stem}`,      format: 'physical', owned: true, ...parent }),
      ]).then(([{ body: o }, { body: p }]) => ({ odysseyId: o.id, phaedoId: p.id }));
    }
    function assertArticleStripped(list, odysseyId, phaedoId, surface) {
      const ids = list.map(x => x.id);
      const oi = ids.indexOf(odysseyId);
      const pi = ids.indexOf(phaedoId);
      assert.ok(oi !== -1 && pi !== -1, `both books should appear in ${surface}`);
      assert.ok(oi < pi,
        `${surface}: 'The Odyssey' should sort under O (article-stripped) before 'Phaedo'; got order ${ids.join(',')}`);
    }

    it('shelf drilldown article-strips the title fallback', async () => {
      const stem = 'art-shelf-' + Math.random().toString(36).slice(2, 6);
      const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: stem });
      const { odysseyId, phaedoId } = await makeArticleStripFixture(stem, { shelf_id: sh.id });
      const { body: list } = await req('GET', `/api/shelf/shelves/${sh.id}/books`);
      assertArticleStripped(list, odysseyId, phaedoId, 'shelf drilldown');
    });

    it('unit drilldown article-strips the title fallback', async () => {
      const stem = 'art-unit-' + Math.random().toString(36).slice(2, 6);
      const { body: u }  = await req('POST', '/api/shelf/units',   { room_id: roomId, name: stem });
      const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: u.id, label: stem });
      const { odysseyId, phaedoId } = await makeArticleStripFixture(stem, { shelf_id: sh.id });
      const { body: list } = await req('GET', `/api/shelf/units/${u.id}/books`);
      assertArticleStripped(list, odysseyId, phaedoId, 'unit drilldown');
    });

    it('room drilldown article-strips the title fallback', async () => {
      const stem = 'art-room-' + Math.random().toString(36).slice(2, 6);
      const { body: r }  = await req('POST', '/api/shelf/rooms',   { building_id: buildingId, name: stem });
      const { body: u }  = await req('POST', '/api/shelf/units',   { room_id: r.id, name: stem });
      const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: u.id, label: stem });
      const { odysseyId, phaedoId } = await makeArticleStripFixture(stem, { shelf_id: sh.id });
      const { body: list } = await req('GET', `/api/shelf/rooms/${r.id}/books`);
      assertArticleStripped(list, odysseyId, phaedoId, 'room drilldown');
    });

    it('building drilldown article-strips the title fallback', async () => {
      const stem = 'art-bldg-' + Math.random().toString(36).slice(2, 6);
      const { body: b }  = await req('POST', '/api/shelf/buildings', { name: stem });
      const { body: r }  = await req('POST', '/api/shelf/rooms',     { building_id: b.id, name: stem });
      const { body: u }  = await req('POST', '/api/shelf/units',     { room_id: r.id, name: stem });
      const { body: sh } = await req('POST', '/api/shelf/shelves',   { unit_id: u.id, label: stem });
      const { odysseyId, phaedoId } = await makeArticleStripFixture(stem, { shelf_id: sh.id });
      const { body: list } = await req('GET', `/api/shelf/buildings/${b.id}/books`);
      assertArticleStripped(list, odysseyId, phaedoId, 'building drilldown');
    });

    it('unshelfed list article-strips the title sort', async () => {
      const stem = 'art-uns-' + Math.random().toString(36).slice(2, 6);
      // No shelf/unit/room/building → unshelfed.
      const { odysseyId, phaedoId } = await makeArticleStripFixture(stem, {});
      const { body: list } = await req('GET', '/api/shelf/unshelfed');
      assertArticleStripped(list, odysseyId, phaedoId, '/unshelfed');
    });

    it('positioned books come before NULL-position books', async () => {
      // Mixing the two branches: one book given an explicit shelf_position via
      // PUT /order, one left at NULL. The CASE WHEN clause must put the
      // positioned book first regardless of title.
      const stem = 'mixed-' + Math.random().toString(36).slice(2, 6);
      const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: `${stem} shelf` });
      // Title ordering would put Aardvark first; explicit position should override.
      const { body: aardvark } = await req('POST', '/api/books', {
        title: `${stem} Aardvark`, format: 'physical', owned: true, shelf_id: sh.id,
      });
      const { body: zebra } = await req('POST', '/api/books', {
        title: `${stem} Zebra`, format: 'physical', owned: true, shelf_id: sh.id,
      });
      // Position only Zebra — Aardvark stays at NULL.
      const { status } = await req('PUT', `/api/shelf/shelves/${sh.id}/order`, { ids: [zebra.id] });
      assert.equal(status, 204);
      const { body: list } = await req('GET', `/api/shelf/shelves/${sh.id}/books`);
      const ids = list.map(x => x.id);
      assert.equal(ids[0], zebra.id, 'positioned book must come first even when title would lose');
      assert.equal(ids[1], aardvark.id);
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
