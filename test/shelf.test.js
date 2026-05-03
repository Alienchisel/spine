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

    it('PUT /api/shelf/buildings/order returns 400 when ids is not an array', async () => {
      const { status, body } = await req('PUT', '/api/shelf/buildings/order', { ids: 'bad' });
      assert.equal(status, 400);
      assert.equal(body.error, 'ids must be an array');
    });

    it('PUT /api/shelf/rooms/order returns 400 when ids is not an array', async () => {
      const { status, body } = await req('PUT', '/api/shelf/rooms/order', { ids: 'bad' });
      assert.equal(status, 400);
      assert.equal(body.error, 'ids must be an array');
    });

    it('PUT /api/shelf/units/order returns 400 when ids is not an array', async () => {
      const { status, body } = await req('PUT', '/api/shelf/units/order', { ids: 'bad' });
      assert.equal(status, 400);
      assert.equal(body.error, 'ids must be an array');
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

    it('shelf order rejects non-array ids', async () => {
      const { status } = await req('PUT', `/api/shelf/shelves/${shelfId}/order`, { ids: 'bad' });
      assert.equal(status, 400);
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
    let buildingBookId;

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
      const { body: bb } = await req('POST', '/api/books', { title: 'Building Book', owned: true, building_id: buildingId });
      buildingBookId = bb.id;
    });

    it('GET /api/shelf/unshelfed includes owned books with no location', async () => {
      const { body } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(body.some(b => b.id === unshelfedBookId));
    });

    it('GET /api/shelf/unshelfed excludes books with a shelf assignment', async () => {
      const { body } = await req('GET', '/api/shelf/unshelfed');
      assert.ok(!body.some(b => b.id === shelfedBookId));
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

    it('GET /api/shelf/buildings/:id/books includes book on a shelf in that building', async () => {
      const { body } = await req('GET', `/api/shelf/buildings/${buildingId}/books`);
      assert.ok(body.some(b => b.id === shelfedBookId));
      assert.ok(body.some(b => b.id === buildingBookId));
    });
  });
});
