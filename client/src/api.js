async function request(path, options = {}) {
  // FormData bodies need the browser to set Content-Type (so it can
  // include the multipart boundary string). Skip our JSON default in
  // that case, otherwise multer rejects the body as malformed.
  const isFormData = options.body instanceof FormData;
  const headers = isFormData
    ? { ...options.headers }
    : { 'Content-Type': 'application/json', ...options.headers };
  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || 'Request failed');
    e.status = res.status;
    throw e;
  }
  if (res.status === 204) return null;
  return res.json();
}

function buildQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach(item => q.append(k, String(item)));
    else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  getBooks: (params = {}) => request(`/books${buildQuery(params)}`),
  getBookFacets: (params = {}) => request(`/books/facets${buildQuery(params)}`),
  getBookCounts: () => request('/books/counts'),
  getBookLists: (bookId) => request(`/books/${bookId}/lists`),
  getBookLog: (bookId) => request(`/books/${bookId}/log`),
  getBook: (id) => request(`/books/${id}`),
  // Accepts an already-formed query string (e.g. location.search) so
  // the caller can forward the current Library tab/filters and the
  // random pick lands within that pool.
  getRandomBook: (search = '') => request(`/books/random${search || ''}`),
  getAuthors: () => request('/authors'),
  getTags: () => request('/tags'),
  getSeries: () => request('/series'),
  getAuthor: (id, params = {}) => request(`/authors/${id}${buildQuery(params)}`),
  updateAuthor: (id, data) => request(`/authors/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  refreshAuthor: (id) => request(`/authors/${id}/refresh`, { method: 'POST' }),
  getCollage: (params = {}) => request(`/collage${buildQuery(params)}`),
  getCollageFacets: () => request('/collage/facets'),
  uploadAuthorPhoto: (id, file) => {
    // multer expects a multipart form with a 'photo' field — same shape
    // as routes/uploads.js's 'cover' field on the book-cover path. The
    // request helper detects FormData and skips its JSON Content-Type.
    const fd = new FormData();
    fd.append('photo', file);
    return request(`/authors/${id}/photo`, { method: 'POST', body: fd });
  },
  deleteAuthorPhoto: (id) => request(`/authors/${id}/photo`, { method: 'DELETE' }),
  createBook: (data) => request('/books', { method: 'POST', body: JSON.stringify(data) }),
  updateBook: (id, data) => request(`/books/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  searchBooks: (q) => request(`/search?${new URLSearchParams({ q })}`),
  fetchBookDescription: (key) => request(`/search/description?${new URLSearchParams({ key })}`),
  patchBook: (id, data) => request(`/books/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getBookReads: (bookId) => request(`/books/${bookId}/reads`),
  addRead: (bookId, data) => request(`/books/${bookId}/reads`, { method: 'POST', body: JSON.stringify(data) }),
  rereadBook: (bookId, data) => request(`/books/${bookId}/reread`, { method: 'POST', body: JSON.stringify(data) }),
  updateRead: (bookId, readId, data) => request(`/books/${bookId}/reads/${readId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRead: (bookId, readId) => request(`/books/${bookId}/reads/${readId}`, { method: 'DELETE' }),
  getBookStories: (bookId) => request(`/books/${bookId}/stories`),
  addStory: (bookId, data) => request(`/books/${bookId}/stories`, { method: 'POST', body: JSON.stringify(data) }),
  updateStory: (bookId, storyId, data) => request(`/books/${bookId}/stories/${storyId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStory: (bookId, storyId) => request(`/books/${bookId}/stories/${storyId}`, { method: 'DELETE' }),
  deleteBook: (id) => request(`/books/${id}`, { method: 'DELETE' }),
  fetchBookCover: (id) => request(`/books/${id}/fetch-cover`, { method: 'POST' }),
  linkEdition: (id, otherId) => request(`/books/${id}/work-link`, { method: 'POST', body: JSON.stringify({ other_id: otherId }) }),
  unlinkEdition: (id) => request(`/books/${id}/work-link`, { method: 'DELETE' }),
  uploadCover: (file) => {
    const fd = new FormData();
    fd.append('cover', file);
    return fetch('/api/upload', { method: 'POST', body: fd }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      return data;
    });
  },
  fetchCover: (url) => request('/upload/fetch', { method: 'POST', body: JSON.stringify({ url }) }),
  getReadlist: () => request('/readlist'),
  reorderReadlist: (ids) => request('/readlist/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  setDesireOrder: (ids) => request('/books/desire-order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  getDiary: (year) => request(`/diary${year ? `?year=${year}` : ''}`),
  deleteDiaryEntry: (id) => request(`/diary/${id}`, { method: 'DELETE' }),
  getLists: () => request('/lists'),
  getList: (id, params = {}) => request(`/lists/${id}${buildQuery(params)}`),
  createList: (name) => request('/lists', { method: 'POST', body: JSON.stringify({ name }) }),
  renameList: (id, name) => request(`/lists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteList: (id) => request(`/lists/${id}`, { method: 'DELETE' }),
  addToList: (listId, bookId) => request(`/lists/${listId}/books`, { method: 'POST', body: JSON.stringify({ book_id: bookId }) }),
  removeFromList: (listId, bookId) => request(`/lists/${listId}/books/${bookId}`, { method: 'DELETE' }),
  reorderList: (listId, ids) => request(`/lists/${listId}/order`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  getShelfTree: () => request('/shelf/tree'),
  getBuildings: () => request('/shelf/buildings'),
  createBuilding: (data) => request('/shelf/buildings', { method: 'POST', body: JSON.stringify(data) }),
  updateBuilding: (id, data) => request(`/shelf/buildings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBuilding: (id) => request(`/shelf/buildings/${id}`, { method: 'DELETE' }),
  getBuildingRooms: (id) => request(`/shelf/buildings/${id}/rooms`),
  createRoom: (data) => request('/shelf/rooms', { method: 'POST', body: JSON.stringify(data) }),
  updateRoom: (id, data) => request(`/shelf/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoom: (id) => request(`/shelf/rooms/${id}`, { method: 'DELETE' }),
  getRoomUnits: (id) => request(`/shelf/rooms/${id}/units`),
  createUnit: (data) => request('/shelf/units', { method: 'POST', body: JSON.stringify(data) }),
  updateUnit: (id, data) => request(`/shelf/units/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUnit: (id) => request(`/shelf/units/${id}`, { method: 'DELETE' }),
  getUnitShelves: (id) => request(`/shelf/units/${id}/shelves`),
  createShelf: (data) => request('/shelf/shelves', { method: 'POST', body: JSON.stringify(data) }),
  updateShelf: (id, data) => request(`/shelf/shelves/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteShelf: (id) => request(`/shelf/shelves/${id}`, { method: 'DELETE' }),
  getBuildingBooks: (buildingId) => request(`/shelf/buildings/${buildingId}/books`),
  getRoomBooks: (roomId) => request(`/shelf/rooms/${roomId}/books`),
  getUnitBooks: (unitId) => request(`/shelf/units/${unitId}/books`),
  getShelfBooks: (shelfId) => request(`/shelf/shelves/${shelfId}/books`),
  reorderBuildings: (ids) => request('/shelf/buildings/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  reorderRooms: (buildingId, ids) => request('/shelf/rooms/order', { method: 'PUT', body: JSON.stringify({ building_id: buildingId, ids }) }),
  reorderUnits: (roomId, ids) => request('/shelf/units/order', { method: 'PUT', body: JSON.stringify({ room_id: roomId, ids }) }),
  reorderShelves: (unitId, ids) => request('/shelf/shelves/order', { method: 'PUT', body: JSON.stringify({ unit_id: unitId, ids }) }),
  reorderShelf: (shelfId, ids) => request(`/shelf/shelves/${shelfId}/order`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  getUnshelfedBooks: () => request('/shelf/unshelfed'),
  getShelfLocation: (bookId) => request(`/shelf/location/${bookId}`),
  getStats: () => request('/stats'),
  getSettings: () => request('/settings'),
  setSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
};
