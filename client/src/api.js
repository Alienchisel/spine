import { dispatchSpineEvent } from './hooks/useSpineEvent.js';

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
    // Validation routes echo the offending field name so forms can
    // switch to the right tab / highlight the input inline.
    if (err.field) e.field = err.field;
    throw e;
  }
  // Any successful write, announced from the single choke point. The
  // queryClient bridge turns this into a broad list-key invalidation,
  // so a mutation surface that forgets its precise spine:book-mutated
  // dispatch can no longer leave other pages' caches stale.
  if ((options.method || 'GET').toUpperCase() !== 'GET') {
    dispatchSpineEvent('spine:data-mutated');
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
  getTodayCard: (params = {}) => request(`/today/card${buildQuery(params)}`),
  getPastConnections: () => request('/today/connections'),
  getPastReadingPaths: () => request('/today/reading-paths'),
  postTodayFeedback: (queueId, value) => request(`/today/queue/${queueId}/feedback`, {
    method: 'POST', body: JSON.stringify({ value }),
  }),
  postTodaySnooze: (bookId, days) => request('/today/snooze', {
    method: 'POST', body: JSON.stringify({ book_id: bookId, days }),
  }),
  getTodayQueueDepth: () => request('/today/queue-depth'),
  getBookLists: (bookId) => request(`/books/${bookId}/lists`),
  getBookLog: (bookId) => request(`/books/${bookId}/log`),
  getBook: (id) => request(`/books/${id}`),
  // Accepts an already-formed query string (e.g. location.search) so
  // the caller can forward the current Library tab/filters and the
  // random pick lands within that pool.
  getRandomBook: (search = '') => request(`/books/random${search || ''}`),
  getAuthors: (params = {}) => request(`/authors${buildQuery(params)}`),
  getRandomAuthor: () => request('/authors/random'),
  getTags: () => request('/tags'),
  getSeries: (params = {}) => request(`/series${buildQuery(params)}`),
  patchSeriesLoved: (series, loved) => request('/series/loved', { method: 'PATCH', body: JSON.stringify({ series, loved }) }),
  getAuthor: (id, params = {}) => request(`/authors/${id}${buildQuery(params)}`),
  updateAuthor: (id, data) => request(`/authors/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  refreshAuthor: (id) => request(`/authors/${id}/refresh`, { method: 'POST' }),
  mergeAuthor: (id, otherId) => request(`/authors/${id}/merge`, { method: 'POST', body: JSON.stringify({ other_id: otherId }) }),
  searchAuthorsOL: (q) => request(`/authors/search-ol?${new URLSearchParams({ q })}`),
  setAuthorPhotoFromUrl: (id, url) => request(`/authors/${id}/photo/url`, { method: 'POST', body: JSON.stringify({ url }) }),
  deleteAuthorPhoto: (id) => request(`/authors/${id}/photo`, { method: 'DELETE' }),
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
  addStory: (bookId, data) => request(`/books/${bookId}/stories`, { method: 'POST', body: JSON.stringify(data) }),
  updateStory: (bookId, storyId, data) => request(`/books/${bookId}/stories/${storyId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStory: (bookId, storyId) => request(`/books/${bookId}/stories/${storyId}`, { method: 'DELETE' }),
  deleteBook: (id) => request(`/books/${id}`, { method: 'DELETE' }),
  fetchBookCover: (id) => request(`/books/${id}/fetch-cover`, { method: 'POST' }),
  // Combined fetch-URL + set-cover_path. Used by the cover wizard so a
  // transient failure between download and patch doesn't orphan an
  // uploaded file on disk (the server cleans up on patch failure).
  setBookCoverFromUrl: (id, url) => request(`/books/${id}/cover/url`, { method: 'POST', body: JSON.stringify({ url }) }),
  linkEdition: (id, otherId) => request(`/books/${id}/work-link`, { method: 'POST', body: JSON.stringify({ other_id: otherId }) }),
  unlinkEdition: (id) => request(`/books/${id}/work-link`, { method: 'DELETE' }),
  getDuplicateClusters: () => request('/books/duplicate-clusters'),
  mergeBook: (survivorId, loserId) => request(`/books/${survivorId}/merge`, { method: 'POST', body: JSON.stringify({ other_id: loserId }) }),
  uploadCover: (file) => {
    const fd = new FormData();
    fd.append('cover', file);
    return fetch('/api/upload', { method: 'POST', body: fd }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      dispatchSpineEvent('spine:data-mutated');
      return data;
    });
  },
  fetchCover: (url) => request('/upload/fetch', { method: 'POST', body: JSON.stringify({ url }) }),
  getReadlist: () => request('/readlist'),
  getDiary: (year) => request(`/diary${year ? `?year=${year}` : ''}`),
  deleteDiaryEntry: (id) => request(`/diary/${id}`, { method: 'DELETE' }),
  getLists: () => request('/lists'),
  getList: (id, params = {}) => request(`/lists/${id}${buildQuery(params)}`),
  createList: (name, description) => request('/lists', { method: 'POST', body: JSON.stringify({ name, description }) }),
  updateList: (id, data) => request(`/lists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteList: (id) => request(`/lists/${id}`, { method: 'DELETE' }),
  addToList: (listId, bookId) => request(`/lists/${listId}/books`, { method: 'POST', body: JSON.stringify({ book_id: bookId }) }),
  removeFromList: (listId, bookId) => request(`/lists/${listId}/books/${bookId}`, { method: 'DELETE' }),
  reorderList: (listId, ids) => request(`/lists/${listId}/order`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  getShelfTree: () => request('/shelf/tree'),
  createBuilding: (data) => request('/shelf/buildings', { method: 'POST', body: JSON.stringify(data) }),
  updateBuilding: (id, data) => request(`/shelf/buildings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBuilding: (id) => request(`/shelf/buildings/${id}`, { method: 'DELETE' }),
  createRoom: (data) => request('/shelf/rooms', { method: 'POST', body: JSON.stringify(data) }),
  updateRoom: (id, data) => request(`/shelf/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoom: (id) => request(`/shelf/rooms/${id}`, { method: 'DELETE' }),
  createUnit: (data) => request('/shelf/units', { method: 'POST', body: JSON.stringify(data) }),
  updateUnit: (id, data) => request(`/shelf/units/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUnit: (id) => request(`/shelf/units/${id}`, { method: 'DELETE' }),
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
  getReadingCalendar: () => request('/stats/reading-calendar'),
  getLibraryTrajectory: () => request('/stats/library-trajectory'),
  getAudit: () => request('/stats/audit'),
  getSeriesCompletion: () => request('/series/completion'),
  getSettings: () => request('/settings'),
  setSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  getDataVersion: () => request('/version'),
};
